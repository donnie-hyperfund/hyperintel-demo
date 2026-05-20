/**
 * Shared artifact query helpers.
 *
 * Used across multiple artifact API routes to avoid duplicating
 * version-loading logic.
 */

import { type FilterQuery, raw } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ArtifactVersionEntity, type VersionStatus } from '@/lib/orm/entities/artifacts/artifact-version.entity';

/**
 * Predicate that excludes ArtifactEntity rows with no persisted ArtifactVersion children.
 *
 * `reserveDraftVersion` inserts an ArtifactEntity at begin_document and only writes the
 * matching ArtifactVersion row at finalize_document. If finalize never runs (agent
 * abort, worker crash) the parent row lingers with `current_version = null` and zero
 * versions until the scheduled-cleanup sweeper removes it. Every user-facing read
 * needs to hide those rows so the UI never shows phantom "no content" documents.
 *
 * Pass the alias used for ArtifactEntity in the calling query — required because
 * MikroORM's `raw()` does not know the alias context.
 */
export function whereArtifactHasVersions(alias: string): Record<string, unknown> {
    return {
        [raw(`EXISTS (SELECT 1 FROM artifact_versions av WHERE av.artifact_id = ${alias}.id)`)]: [],
    };
}

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
