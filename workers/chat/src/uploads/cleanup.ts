import { raw } from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/knex';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { initInferredContext } from '@/workers/_common/context.helpers';
import { createStaleCleanupCutoff, STALE_CLEANUP_BATCH_SIZE } from '../maintenance/cleanup-policy';

export type UploadCleanupResult = {
    staleArtifactUploads: number;
    abandonedStagedArtifacts: number;
    staleImageUploads: number;
};

export type CleanupStaleUploadsOptions = {
    em: SqlEntityManager;
    env: ChatEnv;
    cutoff: Date;
};

/**
 * Sweep dead artifact files past the cutoff. Covers two cases:
 *   1. status='pending_upload' — presign issued but the client never confirmed the upload.
 *      Safe to purge regardless of scope; nothing downstream ever saw this file.
 *   2. status='uploaded' on a scoped artifact — confirmed upload where extraction stalled
 *      or failed silently (queue drop, worker crash, etc.). Without this, the file + version
 *      sit forever in limbo with no extracted_content, invisible to the UI.
 *
 * We deliberately DO NOT sweep status='uploaded' on UNSCOPED artifacts: those are the
 * valid resting state for staged uploads awaiting association (post-deferred-extraction fix).
 * Staged-orphan cleanup is handled separately in processStaleStagedArtifactsBatch.
 */
async function processArtifactBatch({ em, env, cutoff }: CleanupStaleUploadsOptions): Promise<number> {
    const staleFiles = await em.find(
        ArtifactFileEntity,
        {
            created_at: { $lt: cutoff },
            $or: [
                // Never-confirmed uploads — safe to purge regardless of scope.
                { status: 'pending_upload' },
                // Confirmed but extraction stalled — only sweep scoped ones; unscoped uploaded
                // files are the resting state of staged artifacts awaiting association.
                {
                    status: 'uploaded',
                    artifact_version: {
                        artifact: {
                            $or: [{ project: { $ne: null } }, { chat: { $ne: null } }],
                        },
                    },
                },
            ],
        },
        { populate: ['artifact_version.artifact'], limit: STALE_CLEANUP_BATCH_SIZE },
    );

    if (staleFiles.length === 0) return 0;

    await Promise.allSettled(staleFiles.map((file) => env.ARTIFACTS_BUCKET.delete(file.storage_key)));

    const orphanChecks = await Promise.all(
        staleFiles.map(async (file) => {
            const version = file.artifact_version;
            const otherVersions = await em.count(ArtifactVersionEntity, {
                artifact: version.artifact.id,
                id: { $ne: version.id },
            });
            return { file, version, artifact: version.artifact, isOrphan: otherVersions === 0 };
        }),
    );

    for (const { file, version, artifact, isOrphan } of orphanChecks) {
        em.remove(file);
        em.remove(version);
        if (isOrphan) em.remove(artifact);
    }

    await em.flush();
    em.clear();

    return staleFiles.length;
}

/**
 * Clean up staged artifacts that were never associated with a chat or project.
 * Covers the "user uploaded on the /new-chat page then abandoned" case — artifact is
 * fully created (and possibly even extracted, for legacy data) but no scope was ever set.
 *
 * Matches: project IS NULL AND chat IS NULL AND user IS NULL AND metadata.stagedBy IS NOT NULL.
 * The `metadata.stagedBy` marker is the ownership signal; associate-time clears it, so any
 * artifact that still has it past the cutoff was abandoned.
 *
 * NOTE: doesn't sweep embedded-image R2 objects at `uploads/staged/{artifactId}/images/`.
 * Post-fix, extraction is deferred for staged uploads so those objects shouldn't exist.
 * Any pre-fix leftovers need a separate R2-listing sweep.
 */
async function processStaleStagedArtifactsBatch({ em, env, cutoff }: CleanupStaleUploadsOptions): Promise<number> {
    const staleArtifacts = await em.find(
        ArtifactEntity,
        {
            project: null,
            chat: null,
            user: null,
            [raw((alias) => `${alias}.metadata->>'stagedBy'`)]: { $ne: null },
            created_at: { $lt: cutoff },
        },
        { populate: ['versions'], limit: STALE_CLEANUP_BATCH_SIZE },
    );

    if (staleArtifacts.length === 0) return 0;

    const versionIds = staleArtifacts.flatMap((artifact) => artifact.versions.getItems().map((version) => version.id));

    const files = versionIds.length ? await em.find(ArtifactFileEntity, { artifact_version: { $in: versionIds } }) : [];

    // Best-effort R2 deletion — DB rows go regardless.
    await Promise.allSettled(files.map((file) => env.ARTIFACTS_BUCKET.delete(file.storage_key)));

    for (const file of files) em.remove(file);
    for (const artifact of staleArtifacts) {
        for (const version of artifact.versions.getItems()) em.remove(version);
        em.remove(artifact);
    }

    await em.flush();
    em.clear();

    return staleArtifacts.length;
}

/**
 * Clean up orphaned chat-message image files. Covers:
 *   1. status='pending_upload' past cutoff — presign issued but upload never confirmed.
 *   2. chat_id IS NULL past cutoff — staged upload the user abandoned before sending.
 *
 * TODO: not yet covered — needs a separate sweep:
 *   - Chat-deletion orphans. The chat_id FK is ON DELETE SET NULL, so in theory these
 *     land in case #2. But that relies on hard-delete cascades actually firing, and any
 *     soft-delete / archive flow would bypass it. Not verified end-to-end.
 *   - Message-deletion orphans (chat_message_id=NULL, chat_id still set, status='uploaded').
 *     Today these live forever — the message is gone but the R2 object + DB row persist.
 *   - R2 objects with no matching DB row (partial-write / race at upload or associate time).
 *     Would require a listing-based sweep, not the DB-driven one below.
 */
async function processImageBatch({ em, env, cutoff }: CleanupStaleUploadsOptions): Promise<number> {
    const staleFiles = await em.find(
        ChatMessageFileEntity,
        {
            created_at: { $lt: cutoff },
            $or: [{ status: 'pending_upload' }, { chat_id: null }],
        },
        { limit: STALE_CLEANUP_BATCH_SIZE },
    );

    if (staleFiles.length === 0) return 0;

    await Promise.allSettled(staleFiles.map((file) => env.USER_IMAGES_BUCKET.delete(file.storage_key)));

    for (const file of staleFiles) em.remove(file);

    await em.flush();
    em.clear();

    return staleFiles.length;
}

function hasUploadCleanupWork(result: UploadCleanupResult): boolean {
    return result.staleArtifactUploads > 0 || result.abandonedStagedArtifacts > 0 || result.staleImageUploads > 0;
}

function logUploadCleanupResult(result: UploadCleanupResult): void {
    if (!hasUploadCleanupWork(result)) return;
    console.log(
        `[cleanup] Removed ${result.staleArtifactUploads} stale artifact uploads, ` +
            `${result.abandonedStagedArtifacts} abandoned staged artifacts, ` +
            `${result.staleImageUploads} stale image uploads`,
    );
}

async function cleanupStaleUploadsWithContext(options: CleanupStaleUploadsOptions): Promise<UploadCleanupResult> {
    let totalArtifacts = 0;
    let totalStagedArtifacts = 0;
    let totalImages = 0;

    const processArtifacts = async (): Promise<void> => {
        const removed = await processArtifactBatch(options);
        totalArtifacts += removed;
        if (removed >= STALE_CLEANUP_BATCH_SIZE) await processArtifacts();
    };

    const processStagedArtifacts = async (): Promise<void> => {
        const removed = await processStaleStagedArtifactsBatch(options);
        totalStagedArtifacts += removed;
        if (removed >= STALE_CLEANUP_BATCH_SIZE) await processStagedArtifacts();
    };

    const processImages = async (): Promise<void> => {
        const removed = await processImageBatch(options);
        totalImages += removed;
        if (removed >= STALE_CLEANUP_BATCH_SIZE) await processImages();
    };

    await processArtifacts();
    await processStagedArtifacts();
    await processImages();

    return {
        staleArtifactUploads: totalArtifacts,
        abandonedStagedArtifacts: totalStagedArtifacts,
        staleImageUploads: totalImages,
    };
}

export async function cleanupStaleUploads(input: ChatEnv | CleanupStaleUploadsOptions): Promise<UploadCleanupResult> {
    if ('em' in input) {
        return cleanupStaleUploadsWithContext(input);
    }

    const ctx = await initInferredContext(input, {}, { withOrm: true });
    const result = await cleanupStaleUploadsWithContext({
        em: ctx.em,
        env: input,
        cutoff: createStaleCleanupCutoff(),
    });
    logUploadCleanupResult(result);
    return result;
}
