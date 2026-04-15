// TODO: Also clean up orphaned artifact uploads — files that were confirmed ('uploaded')
//       but never linked to a version/message (e.g. user abandoned the form after uploading).

import type { SqlEntityManager } from '@mikro-orm/knex';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { initInferredContext } from '@/workers/_common/context.helpers';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

async function processArtifactBatch(em: SqlEntityManager, env: Env, cutoff: Date): Promise<number> {
    const staleFiles = await em.find(
        ArtifactFileEntity,
        { status: 'pending_upload', created_at: { $lt: cutoff } },
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
async function processImageBatch(em: SqlEntityManager, env: Env, cutoff: Date): Promise<number> {
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

export async function cleanupStaleUploads(env: Env) {
    const ctx = await initInferredContext(env, {}, { withOrm: true });
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    let totalArtifacts = 0;
    let totalImages = 0;

    const processArtifacts = async (): Promise<void> => {
        const removed = await processArtifactBatch(ctx.em, env, cutoff);
        totalArtifacts += removed;
        if (removed >= BATCH_SIZE) await processArtifacts();
    };

    const processImages = async (): Promise<void> => {
        const removed = await processImageBatch(ctx.em, env, cutoff);
        totalImages += removed;
        if (removed >= BATCH_SIZE) await processImages();
    };

    await processArtifacts();
    await processImages();

    if (totalArtifacts > 0 || totalImages > 0) {
        console.log(`[cleanup] Removed ${totalArtifacts} stale artifact uploads, ${totalImages} stale image uploads`);
    }
}
