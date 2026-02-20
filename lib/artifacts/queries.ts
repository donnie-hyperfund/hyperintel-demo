/**
 * Shared artifact query helpers.
 *
 * Used across multiple artifact API routes to avoid duplicating
 * version-loading logic.
 */

import { type FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ArtifactVersionEntity, type VersionStatus } from '@/lib/orm/entities/artifacts/artifact-version.entity';

/**
 * Batch-load one version per artifact, filtered by optional status.
 * Returns latest (highest version number) matching version per artifact.
 *
 * @param status - If provided, only load versions with this status. If omitted, loads latest regardless of status.
 */
export async function loadVersionsForArtifacts(
    em: EntityManager,
    artifactIds: string[],
    status?: VersionStatus,
): Promise<Map<string, ArtifactVersionEntity>> {
    if (!artifactIds.length) return new Map();

    const where: FilterQuery<ArtifactVersionEntity> = { artifact: { $in: artifactIds } };
    if (status) where.status = status;

    const versions = await em.find(ArtifactVersionEntity, where, {
        orderBy: { version: 'DESC' },
    });

    // Keep only the first (latest) version per artifact
    const map = new Map<string, ArtifactVersionEntity>();
    for (const v of versions) {
        if (!map.has(v.artifact.id)) {
            map.set(v.artifact.id, v);
        }
    }
    return map;
}