import { raw } from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/knex';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { initInferredContext } from '@/workers/_common/context.helpers';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

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
async function processArtifactBatch(em: SqlEntityManager, env: ChatEnv, cutoff: Date): Promise<number> {
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
        { populate: ['artifact_version.artifact'], limit: BATCH_SIZE },
    );

    if (staleFiles.length === 0) return 0;

    await Promise.allSettled(staleFiles.map((f) => env.ARTIFACTS_BUCKET.delete(f.storage_key)));

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
async function processStaleStagedArtifactsBatch(em: SqlEntityManager, env: ChatEnv, cutoff: Date): Promise<number> {
    const staleArtifacts = await em.find(
        ArtifactEntity,
        {
            project: null,
            chat: null,
            user: null,
            [raw((alias) => `${alias}.metadata->>'stagedBy'`)]: { $ne: null },
            created_at: { $lt: cutoff },
        },
        { populate: ['versions'], limit: BATCH_SIZE },
    );

    if (staleArtifacts.length === 0) return 0;

    const versionIds = staleArtifacts.flatMap((a) => a.versions.getItems().map((v) => v.id));

    const files = versionIds.length ? await em.find(ArtifactFileEntity, { artifact_version: { $in: versionIds } }) : [];

    // Best-effort R2 deletion — DB rows go regardless.
    await Promise.allSettled(files.map((f) => env.ARTIFACTS_BUCKET.delete(f.storage_key)));

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
async function processImageBatch(em: SqlEntityManager, env: ChatEnv, cutoff: Date): Promise<number> {
    const staleFiles = await em.find(
        ChatMessageFileEntity,
        {
            created_at: { $lt: cutoff },
            $or: [{ status: 'pending_upload' }, { chat_id: null }],
        },
        { limit: BATCH_SIZE },
    );

    if (staleFiles.length === 0) return 0;

    await Promise.allSettled(staleFiles.map((f) => env.USER_IMAGES_BUCKET.delete(f.storage_key)));

    for (const file of staleFiles) em.remove(file);

    await em.flush();
    em.clear();

    return staleFiles.length;
}

export async function cleanupStaleUploads(env: ChatEnv) {
    const ctx = await initInferredContext(env, {}, { withOrm: true });
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    let totalArtifacts = 0;
    let totalStagedArtifacts = 0;
    let totalImages = 0;

    const processArtifacts = async (): Promise<void> => {
        const removed = await processArtifactBatch(ctx.em, env, cutoff);
        totalArtifacts += removed;
        if (removed >= BATCH_SIZE) await processArtifacts();
    };

    const processStagedArtifacts = async (): Promise<void> => {
        const removed = await processStaleStagedArtifactsBatch(ctx.em, env, cutoff);
        totalStagedArtifacts += removed;
        if (removed >= BATCH_SIZE) await processStagedArtifacts();
    };

    const processImages = async (): Promise<void> => {
        const removed = await processImageBatch(ctx.em, env, cutoff);
        totalImages += removed;
        if (removed >= BATCH_SIZE) await processImages();
    };

    await processArtifacts();
    await processStagedArtifacts();
    await processImages();

    if (totalArtifacts > 0 || totalStagedArtifacts > 0 || totalImages > 0) {
        console.log(
            `[cleanup] Removed ${totalArtifacts} stale artifact uploads, ` +
                `${totalStagedArtifacts} abandoned staged artifacts, ` +
                `${totalImages} stale image uploads`,
        );
    }
}
