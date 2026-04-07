/**
 * Shared artifact query helpers.
 *
 * Used across multiple artifact API routes to avoid duplicating
 * version-loading logic.
 */

import { type FilterQuery, wrap } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
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

/**
 * For a list of artifact keys, find their associated PECP artifacts and return
 * the latest approved PECP version content, keyed by the parent artifact key.
 *
 * E.g. for parent key "genesis-dna.md" → looks for PECP artifact "genesis-dna-pecp.md"
 */
export async function loadPECPsForArtifactKeys(
    em: EntityManager,
    parentKeys: string[],
    scopeFilter: Record<string, unknown>,
): Promise<Map<string, { id: string; content: string; version: number; created_at: Date }>> {
    if (!parentKeys.length) return new Map();

    const pecpKeys = parentKeys.map((k) => k.replace(/\.md$/, '') + '-pecp.md');

    const pecpArtifacts = await em.find(
        ArtifactEntity,
        { ...scopeFilter, is_pecp: true, key: { $in: pecpKeys } },
        { populate: ['current_version'] },
    );

    const result = new Map<string, { id: string; content: string; version: number; created_at: Date }>();

    for (const pecp of pecpArtifacts) {
        const cv = pecp.current_version;
        if (!cv || cv.status !== 'approved' || !cv.content) continue;

        // Derive parent key from PECP key: "genesis-dna-pecp.md" → "genesis-dna.md"
        const parentKey = pecp.key.replace(/-pecp\.md$/, '.md');
        result.set(parentKey, {
            id: cv.id,
            content: cv.content,
            version: cv.version,
            created_at: cv.created_at,
        });
    }

    return result;
}