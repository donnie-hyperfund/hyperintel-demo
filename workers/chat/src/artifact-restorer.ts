import { PublicError } from '@common/common/error.helpers';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import {
    type RestoreArtifactActionDto,
    type RestoreArtifactResponseDto,
    TERMINAL_VERSION_STATUSES,
} from '@/lib/schema/artifact';
import { generateYAMLForArtifact, publishToUserScopeAndIndexVersion } from './artifact-approver';
import type { Ctx } from './context';
import { shouldGenerateAiContent } from './tools/documents/document-classifier';

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

    const { restoredVersion, meta } = await em.transactional(async (txEm) => {
        const sourceVersion = await txEm
            .createQueryBuilder(ArtifactVersionEntity, 'v')
            .select('v.*')
            .leftJoinAndSelect('v.artifact', 'a')
            .leftJoinAndSelect('a.user', 'au')
            .leftJoinAndSelect('a.project', 'p')
            .leftJoinAndSelect('p.user', 'pu')
            .where({
                'v.id': sourceVersionId,
                $or: [{ 'pu.clerkId': user.userId }, { 'au.clerkId': user.userId }],
            })
            .getSingleResult();

        if (!sourceVersion) {
            throw new PublicError(404, {
                message: 'Source version not found or access denied',
                code: 'VERSION_NOT_FOUND',
            });
        }

        const sourceArtifact = sourceVersion.artifact;
        if (
            !sourceArtifact.project ||
            sourceArtifact.project.id !== projectId ||
            sourceArtifact.key !== normalizedKey
        ) {
            throw new PublicError(400, {
                message: 'Source version does not match the requested project/key',
                code: 'ARTIFACT_VERSION_MISMATCH',
            });
        }

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
        const ownerId = artifact.project?.user?.id;
        const now = new Date();

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
        // Restored versions are intentionally chatless for phase-independent behavior.
        restored.chat = undefined;
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

        return {
            restoredVersion: restored,
            meta: {
                artifactId: artifact.id,
                key: artifact.key,
                sourceVersion: sourceVersion.version,
                restoredVersionNumber: newVersionNumber,
                restoredVersionId: restored.id,
                supersededVersions: supersededVersions.sort((a, b) => a - b),
            },
        };
    });

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
                    // Generating YAML without chat messages because restored versions are chatless.
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

    return {
        success: true,
        artifactId: meta.artifactId,
        key: meta.key,
        sourceVersion: meta.sourceVersion,
        restoredVersion: meta.restoredVersionNumber,
        restoredVersionId: meta.restoredVersionId,
        status: 'approved',
        supersededVersions: meta.supersededVersions,
    };
}
