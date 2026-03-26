import type { SqlEntityManager } from '@mikro-orm/knex';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { initInferredContext } from '@/workers/_common/context.helpers';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

async function processBatch(em: SqlEntityManager, env: Env, cutoff: Date): Promise<number> {
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

export async function cleanupStaleUploads(env: Env) {
    const ctx = await initInferredContext(env, {}, { withOrm: true });
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    let totalRemoved = 0;

    const processNext = async (): Promise<void> => {
        const removed = await processBatch(ctx.em, env, cutoff);
        totalRemoved += removed;
        if (removed >= BATCH_SIZE) await processNext();
    };

    await processNext();

    if (totalRemoved > 0) {
        console.log(`[cleanup] Removed ${totalRemoved} stale uploads`);
    }
}
