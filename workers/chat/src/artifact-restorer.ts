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
import { generateYAMLForArtifact, publishToUserScopeAndIndexVersion } from './artifact-approver';
import type { Ctx } from './context';
import { shouldGenerateAiContent } from './tools/documents/document-classifier';
import { broadcastUserEvent } from './utils/broadcast';
import { injectSystemEvent } from './utils/system-events';

type RestoreMeta = {
    artifactId: string;
    key: string;
    sourceVersionNumber: number;
    sourceStatus: string;
    restoredVersionNumber: number;
    restoredVersionId: string;
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
        nextStatus: 'approved',
    });

    let txResult: { restoredVersion: ArtifactVersionEntity; meta: RestoreMeta };
    try {
        txResult = await em.transactional(async (txEm) => {
            const sourceVersion = await loadAndValidateSource({
                em: txEm,
                sourceVersionId,
                userId: user.userId,
                projectId,
                normalizedKey,
            });

            const sourcePecpVersion = sourceVersion.is_internal
                ? await txEm.findOne(
                      ArtifactVersionEntity,
                      {
                          document_type: 'PECP',
                          status: 'approved',
                          parent_version: sourceVersion.id,
                      },
                      { orderBy: { version: 'DESC' }, populate: ['artifact'] },
                  )
                : null;

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
            // Project: latest phase chat (prior phases are summarized & closed by design).
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
            // Project: latest phase chat — prior phases are summarized & closed by design,
            // so the active phase is where the restore intent lives. Accepted trade-off:
            // edge cases where the user triggers restore from a stale phase are not handled.
            // Intake: the source version's own chat (single chat per artifact lifecycle).
            restored.chat = targetChat ?? undefined;
            restored.version = newVersionNumber;
            restored.content = sourceVersion.content;
            restored.ai_content = sourceVersion.ai_content;
            restored.status = 'approved';
            restored.is_uploaded = sourceVersion.is_uploaded;
            restored.is_internal = sourceVersion.is_internal;
            restored.document_type = sourceVersion.document_type;
            restored.status_changed_at = now;
            restored.status_changed_by = ownerId;

            txEm.persist(restored);
            artifact.version = newVersionNumber;
            artifact.current_version = restored;
            await txEm.flush();

            if (sourcePecpVersion) {
                await txEm.execute('SELECT id FROM artifacts WHERE id = ? FOR UPDATE', [sourcePecpVersion.artifact.id]);

                const pecpArtifact = await txEm.findOne(
                    ArtifactEntity,
                    { id: sourcePecpVersion.artifact.id },
                    { populate: ['versions', 'current_version', 'project', 'project.user', 'user'] },
                );

                if (!pecpArtifact) {
                    throw new PublicError(404, {
                        message: 'PECP artifact not found',
                        code: 'ARTIFACT_NOT_FOUND',
                    });
                }

                const pecpVersions = pecpArtifact.versions.getItems();
                const newPecpVersionNumber = Math.max(...pecpVersions.map((version) => version.version), 0) + 1;
                const pecpOwnerId = pecpArtifact.project?.user?.id ?? pecpArtifact.user?.id ?? ownerId;

                const restoredPecp = new ArtifactVersionEntity();
                restoredPecp.artifact = pecpArtifact;
                restoredPecp.chat = targetChat ?? undefined;
                restoredPecp.parent_version = restored;
                restoredPecp.version = newPecpVersionNumber;
                restoredPecp.content = sourcePecpVersion.content;
                restoredPecp.ai_content = sourcePecpVersion.ai_content;
                restoredPecp.status = 'approved';
                restoredPecp.is_uploaded = sourcePecpVersion.is_uploaded;
                restoredPecp.is_internal = sourcePecpVersion.is_internal;
                restoredPecp.document_type = sourcePecpVersion.document_type;
                restoredPecp.status_changed_at = now;
                restoredPecp.status_changed_by = pecpOwnerId;

                txEm.persist(restoredPecp);
                pecpArtifact.is_pecp = true;
                pecpArtifact.version = newPecpVersionNumber;
                pecpArtifact.current_version = restoredPecp;
                await txEm.flush();
            }

            return {
                restoredVersion: restored,
                meta: {
                    artifactId: artifact.id,
                    key: artifact.key,
                    sourceVersionNumber: sourceVersion.version,
                    sourceStatus: sourceVersion.status,
                    restoredVersionNumber: newVersionNumber,
                    restoredVersionId: restored.id,
                    supersededVersions: supersededVersions.sort((a, b) => a - b),
                    chatId: targetChat?.id,
                    chatType: (targetChat?.type as string) ?? 'phase',
                },
            };
        });
    } catch (err) {
        await broadcastUserEvent(ctx, 'artifact_version_updated', {
            ...broadcastBase,
            status: 'failed',
        });
        throw err;
    }
    const { restoredVersion, meta } = txResult;

    // Best-effort post-transaction: generate YAML if needed, then publish + index.
    // The version is already approved and current — failures here don't affect the restore.
    try {
        if (!restoredVersion.is_uploaded) {
            const isInternalDocument = await shouldGenerateAiContent(
                ctx,
                restoredVersion.artifact.key,
                restoredVersion.artifact.title,
            );

            console.log('[restoreArtifact] Document classification:', {
                documentKey: restoredVersion.artifact.key,
                isInternalDocument,
            });

            let yamlContent = restoredVersion.ai_content;

            // Source versions that were never approved (rejected, superseded) won't have ai_content.
            // Generate it now for internal documents so they get proper YAML and embeddings.
            if (isInternalDocument && !yamlContent) {
                try {
                    // Generate YAML from content alone (no chat messages — the original conversation
                    // context belongs to a different phase and isn't relevant for the restored version's summary).
                    yamlContent = await generateYAMLForArtifact(restoredVersion.content, [], ctx);
                } catch (error) {
                    console.error('[restoreArtifact] YAML generation failed:', error);
                    yamlContent = `# YAML generation failed\n# Error: ${error instanceof Error ? error.message : String(error)}\n\n${restoredVersion.content}`;
                }

                restoredVersion.ai_content = yamlContent;
                await em.flush();
            }

            await publishToUserScopeAndIndexVersion(restoredVersion, ctx, {
                content: isInternalDocument && yamlContent ? yamlContent : restoredVersion.content,
                isAiContent: isInternalDocument,
            });
        }
    } catch (err) {
        console.error('[restoreArtifact] Post-restore processing failed (non-fatal):', err);
    }

    // Notify other tabs / users that the version changed (after all processing, same as approver).
    await broadcastUserEvent(ctx, 'artifact_version_updated', {
        ...broadcastBase,
        restoredVersionNumber: meta.restoredVersionNumber,
        status: 'approved',
    });

    // Inject system event so the agent knows the user restored via UI.
    if (meta.chatId) {
        await injectSystemEvent(ctx, em, {
            chatId: meta.chatId,
            chatType: meta.chatType,
            event: 'artifact_restored',
            description: `User has restored artifact [${meta.key}] from v${meta.sourceVersionNumber} as v${meta.restoredVersionNumber}`,
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
        status: 'approved',
        supersededVersions: meta.supersededVersions,
        chatId: meta.chatId,
        chatType: meta.chatType,
    };
}
