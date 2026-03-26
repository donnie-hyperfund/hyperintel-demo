import type { SqlEntityManager } from '@mikro-orm/knex';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { initInferredContext } from '@/workers/_common/context.helpers';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

async function processStaleUploadsBatch(em: SqlEntityManager, env: Env, cutoff: Date): Promise<number> {
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

async function processStagedArtifactsBatch(em: SqlEntityManager, env: Env, cutoff: Date): Promise<number> {
    const stagedArtifacts = await em.find(
        ArtifactEntity,
        { project: null, chat: null, created_at: { $lt: cutoff } },
        { populate: ['versions'], limit: BATCH_SIZE },
    );

    if (stagedArtifacts.length === 0) return 0;

    // Collect file storage keys to delete from R2
    const versionIds = stagedArtifacts.flatMap((a) => a.versions.getItems().map((v) => v.id));
    const files = versionIds.length > 0
        ? await em.find(ArtifactFileEntity, { artifact_version: { $in: versionIds } })
        : [];

    if (files.length > 0) {
        await Promise.allSettled(files.map((f) => env.ARTIFACTS_BUCKET.delete(f.storage_key)));
        for (const file of files) em.remove(file);
    }

    for (const artifact of stagedArtifacts) {
        for (const version of artifact.versions.getItems()) em.remove(version);
        em.remove(artifact);
    }

    await em.flush();
    em.clear();

    return stagedArtifacts.length;
}

async function drainBatches(fn: (em: SqlEntityManager, env: Env, cutoff: Date) => Promise<number>, em: SqlEntityManager, env: Env, cutoff: Date): Promise<number> {
    let total = 0;
    let removed: number;
    do {
        removed = await fn(em, env, cutoff);
        total += removed;
    } while (removed >= BATCH_SIZE);
    return total;
}

export async function cleanupStaleUploads(env: Env) {
    const ctx = await initInferredContext(env, {}, { withOrm: true });
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    const staleUploads = await drainBatches(processStaleUploadsBatch, ctx.em, env, cutoff);
    const stagedArtifacts = await drainBatches(processStagedArtifactsBatch, ctx.em, env, cutoff);

    if (staleUploads > 0) {
        console.log(`[cleanup] Removed ${staleUploads} stale uploads`);
    }
    if (stagedArtifacts > 0) {
        console.log(`[cleanup] Removed ${stagedArtifacts} orphaned staged artifacts`);
    }
}
