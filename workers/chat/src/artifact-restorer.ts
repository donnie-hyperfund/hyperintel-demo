import { PublicError } from '@common/common/error.helpers';
import type { EntityManager } from '@mikro-orm/postgresql';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import {
    type RestoreArtifactActionDto,
    type RestoreArtifactResponseDto,
    TERMINAL_VERSION_STATUSES,
} from '@/lib/schema/artifact';
import type { Ctx } from './context';
import { countLines } from './tools/documents/document-service';
import { broadcastUserEvent } from './utils/broadcast';
import { callChatServicesSystemAction } from './utils/chat-services';
import { injectSystemEvent } from './utils/system-events';

type RestoreMeta = {
    artifactId: string;
    key: string;
    sourceVersionNumber: number;
    sourceStatus: string;
    restoredVersionNumber: number;
    restoredVersionId: string;
    restoredLines: number;
    restoredDocumentType: string | null;
    supersededVersions: number[];
    chatId?: string;
    chatType: string;
};

type LoadSourceParams = {
    em: EntityManager;
    sourceVersionId: string;
    userId: string;
    projectId?: string;
    normalizedKey: string;
};

async function loadAndValidateSource({
    em,
    sourceVersionId,
    userId,
    projectId,
    normalizedKey,
}: LoadSourceParams): Promise<ArtifactVersionEntity> {
    const source = await em
        .createQueryBuilder(ArtifactVersionEntity, 'v')
        .select('v.*')
        .leftJoinAndSelect('v.artifact', 'a')
        .leftJoinAndSelect('v.chat', 'c')
        .leftJoinAndSelect('a.user', 'au')
        .leftJoinAndSelect('a.project', 'p')
        .leftJoinAndSelect('p.user', 'pu')
        .where({
            'v.id': sourceVersionId,
            $or: [{ 'pu.clerkId': userId }, { 'au.clerkId': userId }],
        })
        .getSingleResult();

    if (!source) {
        throw new PublicError(404, {
            message: 'Source version not found or access denied',
            code: 'VERSION_NOT_FOUND',
        });
    }

    const artifact = source.artifact;
    // Project-scoped: artifact must belong to the requested project.
    // Intake (user-scoped): artifact must be projectless. Key must match in both cases.
    const matchesProjectScope = projectId
        ? artifact.project?.id === projectId && artifact.key === normalizedKey
        : !artifact.project && artifact.key === normalizedKey;

    if (!matchesProjectScope) {
        throw new PublicError(400, {
            message: projectId
                ? 'Source version does not match the requested project/key'
                : 'Source version does not match the requested artifact',
            code: 'ARTIFACT_VERSION_MISMATCH',
        });
    }

    return source;
}

export async function restoreArtifactHandler(
    data: RestoreArtifactActionDto,
    ctx: Ctx,
): Promise<RestoreArtifactResponseDto> {
    const { projectId, sourceVersionId } = data;
    const normalizedKey = normalizeArtifactKey(data.key);
    const { em, user } = ctx;

    if (!em) {
        throw new PublicError(500, {
            message: 'Database connection not available',
            code: 'DATABASE_UNAVAILABLE',
        });
    }

    const preflightSource = await loadAndValidateSource({
        em,
        sourceVersionId,
        userId: user.userId,
        projectId,
        normalizedKey,
    });

    const preflightTargetChat = projectId
        ? await em.findOne(
              ChatEntity,
              { project: { id: projectId }, type: 'phase' },
              { orderBy: { phase_index: 'DESC' } },
          )
        : (preflightSource.chat ?? null);

    const broadcastBase = {
        artifactId: preflightSource.artifact.id,
        artifactName: preflightSource.artifact.key,
        versionId: sourceVersionId,
        sourceVersionNumber: preflightSource.version,
        action: 'restore',
        previousStatus: preflightSource.status,
        projectName: preflightSource.artifact.project?.name,
        phaseName: preflightTargetChat?.name ?? undefined,
        phaseIndex: preflightTargetChat?.phase_index,
        chatId: preflightTargetChat?.id,
    };

    await broadcastUserEvent(ctx, 'artifact_version_update_started', {
        ...broadcastBase,
        nextStatus: 'proposed',
    });

    let meta: RestoreMeta;
    try {
        meta = await em.transactional(async (txEm) => {
            const sourceVersion = await loadAndValidateSource({
                em: txEm,
                sourceVersionId,
                userId: user.userId,
                projectId,
                normalizedKey,
            });

            const sourceArtifact = sourceVersion.artifact;
            // Serialize restore operations on a single artifact to keep version increments consistent.
            await txEm.execute('SELECT id FROM artifacts WHERE id = ? FOR UPDATE', [sourceArtifact.id]);

            const artifact = await txEm.findOne(
                ArtifactEntity,
                { id: sourceArtifact.id },
                { populate: ['versions', 'current_version', 'project', 'project.user', 'user'] },
            );

            if (!artifact) {
                throw new PublicError(404, {
                    message: 'Artifact not found',
                    code: 'ARTIFACT_NOT_FOUND',
                });
            }

            if (artifact.current_version?.id === sourceVersion.id && sourceVersion.status === 'approved') {
                throw new PublicError(400, {
                    message: 'Selected version is already active',
                    code: 'ALREADY_ACTIVE_VERSION',
                });
            }

            const versions = artifact.versions.getItems();
            const maxVersion = Math.max(...versions.map((v) => v.version), 0);

            // Block restore of latest when it's proposed (approve/reject it instead) or approved (already active).
            // Terminal statuses (rejected, superseded, deleted) are always restorable regardless of position.
            if (sourceVersion.version === maxVersion && !TERMINAL_VERSION_STATUSES.includes(sourceVersion.status)) {
                throw new PublicError(400, {
                    message: 'Selected version is already the latest version',
                    code: 'ALREADY_LATEST_VERSION',
                });
            }

            const newVersionNumber = maxVersion + 1;
            const ownerId = artifact.project?.user?.id ?? artifact.user?.id;
            const now = new Date();

            // Resolve the target chat for the restored version + system event injection.
            // Project: latest phase chat (prior phases are transitioned and closed by design).
            // Intake: the source version's own chat (intake has a single chat per artifact).
            const targetChat = projectId
                ? await txEm.findOne(
                      ChatEntity,
                      { project: { id: projectId }, type: 'phase' },
                      { orderBy: { phase_index: 'DESC' } },
                  )
                : (sourceVersion.chat ?? null);

            const supersededVersions: number[] = [];
            for (const version of versions) {
                if (version.status !== 'proposed') continue;
                version.status = 'superseded';
                version.rejection_reason = `Superseded by restored v${newVersionNumber}`;
                version.status_changed_at = now;
                version.status_changed_by = ownerId;
                supersededVersions.push(version.version);
            }

            const restored = new ArtifactVersionEntity();
            restored.artifact = artifact;
            // Project: latest phase chat — prior phases are transitioned and closed by design,
            // so the active phase is where the restore intent lives. Accepted trade-off:
            // edge cases where the user triggers restore from a stale phase are not handled.
            // Intake: the source version's own chat (single chat per artifact lifecycle).
            restored.chat = targetChat ?? undefined;
            restored.version = newVersionNumber;
            restored.title = sourceVersion.title;
            restored.content = sourceVersion.content;
            restored.summary_internal = sourceVersion.summary_internal;
            restored.status = 'proposed';
            restored.is_uploaded = sourceVersion.is_uploaded;
            restored.is_internal = sourceVersion.is_internal;
            restored.document_type = sourceVersion.document_type;
            restored.status_changed_at = now;
            restored.status_changed_by = ownerId;
            restored.metadata = {
                restoredFrom: {
                    versionId: sourceVersion.id,
                    versionNumber: sourceVersion.version,
                    sourceStatus: sourceVersion.status,
                    supersededVersions: [...supersededVersions].sort((a, b) => a - b),
                    at: now.toISOString(),
                    by: ownerId,
                },
            };

            txEm.persist(restored);
            artifact.version = newVersionNumber;

            if (sourceVersion.document_type === 'Completion Brief') {
                const cbChat = await txEm.findOne(ChatEntity, { completion_brief: artifact.id });
                if (cbChat) {
                    cbChat.completion_brief_status = 'proposed';
                }
            }

            await txEm.flush();

            return {
                artifactId: artifact.id,
                key: artifact.key,
                sourceVersionNumber: sourceVersion.version,
                sourceStatus: sourceVersion.status,
                restoredVersionNumber: newVersionNumber,
                restoredVersionId: restored.id,
                restoredLines: countLines(sourceVersion.content ?? ''),
                restoredDocumentType: sourceVersion.document_type ?? null,
                supersededVersions: supersededVersions.sort((a, b) => a - b),
                chatId: targetChat?.id,
                chatType: (targetChat?.type as string) ?? 'phase',
            };
        });
    } catch (err) {
        await broadcastUserEvent(ctx, 'artifact_version_updated', {
            ...broadcastBase,
            status: 'failed',
        });
        throw err;
    }

    await broadcastUserEvent(ctx, 'artifact_version_updated', {
        ...broadcastBase,
        restoredVersionNumber: meta.restoredVersionNumber,
        status: 'proposed',
    });

    if (meta.restoredDocumentType === 'Completion Brief' && meta.chatId) {
        callChatServicesSystemAction(ctx, {
            action: 'cbStatusChanged',
            prefix: 'chat',
            identifier: meta.chatId,
            userId: ctx.user.userId,
            previewAlias: ctx.previewAlias,
            status: 'proposed',
        }).catch((err) => console.error('[restoreArtifact] CB status broadcast failed:', err));
    }

    // Inject system event so the agent knows the user proposed a restore via UI.
    // Pre-compute the ::document[…] directive here — the agent must echo it in its reply
    // for the UI artifact card to render, and inlining the values avoids a read_document round-trip.
    if (meta.chatId) {
        const docTypeAttr = meta.restoredDocumentType ? ` documentType="${meta.restoredDocumentType}"` : '';
        const directive = `::document[${meta.key}]{version=${meta.restoredVersionNumber} lines=${meta.restoredLines}${docTypeAttr}}`;
        await injectSystemEvent(ctx, em, {
            chatId: meta.chatId,
            chatType: meta.chatType,
            event: 'artifact_restored',
            description:
                `User has restored artifact [${meta.key}] v${meta.sourceVersionNumber} ` +
                `as proposed v${meta.restoredVersionNumber} (awaiting approval). ` +
                `Include this directive verbatim in your reply so the artifact card renders: ${directive}. ` +
                `Then briefly acknowledge and ask what they want to do next.`,
            extra: {
                artifactId: meta.artifactId,
                artifactKey: meta.key,
                versionId: meta.restoredVersionId,
                versionNumber: meta.restoredVersionNumber,
                sourceVersionNumber: meta.sourceVersionNumber,
            },
        });
    }

    return {
        success: true,
        artifactId: meta.artifactId,
        key: meta.key,
        sourceVersion: meta.sourceVersionNumber,
        restoredVersion: meta.restoredVersionNumber,
        restoredVersionId: meta.restoredVersionId,
        status: 'proposed',
        supersededVersions: meta.supersededVersions,
        chatId: meta.chatId,
        chatType: meta.chatType,
    };
}
