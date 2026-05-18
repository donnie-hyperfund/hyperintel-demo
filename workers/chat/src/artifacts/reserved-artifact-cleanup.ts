import type { SqlEntityManager } from '@mikro-orm/knex';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { STALE_CLEANUP_BATCH_SIZE } from '../maintenance/cleanup-policy';

export type ReservedArtifactCleanupResult = {
    reservedArtifacts: number;
};

export type CleanupReservedArtifactsOptions = {
    em: SqlEntityManager;
    cutoff: Date;
};

async function processReservedArtifactBatch({ em, cutoff }: CleanupReservedArtifactsOptions): Promise<number> {
    const orphanRows = (await em.getConnection().execute(
        `
        SELECT artifacts.id
        FROM artifacts
        WHERE artifacts.created_at < ?
          AND NOT EXISTS (
            SELECT 1
            FROM artifact_versions
            WHERE artifact_versions.artifact_id = artifacts.id
          )
        LIMIT ?
        `,
        [cutoff, STALE_CLEANUP_BATCH_SIZE],
    )) as Array<{ id: string }>;

    const orphanIds = orphanRows.map((row) => row.id);
    if (orphanIds.length === 0) return 0;

    const removed = await em.nativeDelete(ArtifactEntity, { id: { $in: orphanIds } });
    em.clear();

    return removed;
}

export async function cleanupReservedArtifacts(
    options: CleanupReservedArtifactsOptions,
): Promise<ReservedArtifactCleanupResult> {
    let reservedArtifacts = 0;

    while (true) {
        const removed = await processReservedArtifactBatch(options);
        reservedArtifacts += removed;
        if (removed < STALE_CLEANUP_BATCH_SIZE) break;
    }

    return { reservedArtifacts };
}
