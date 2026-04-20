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

/**
 * For a list of artifact IDs, find their associated PECP content via the
 * parent_version FK. Returns the latest approved PECP version,
 * keyed by the parent artifact ID.
 */
export async function loadPECPsForArtifacts(
    em: EntityManager,
    parentArtifactIds: string[],
): Promise<Map<string, { id: string; content: string; version: number; created_at: Date }>> {
    if (!parentArtifactIds.length) return new Map();

    // Find approved PECP versions whose parent_version belongs to one of the given artifacts
    const pecpVersions = await em.find(
        ArtifactVersionEntity,
        {
            document_type: 'PECP',
            status: 'approved',
            parent_version: { artifact: { $in: parentArtifactIds } },
        },
        {
            populate: ['parent_version.artifact'],
            orderBy: { version: 'DESC' },
        },
    );

    const result = new Map<string, { id: string; content: string; version: number; created_at: Date }>();

    for (const pv of pecpVersions) {
        const parentArtifactId = pv.parent_version?.artifact?.id;
        if (!parentArtifactId || !pv.content) continue;
        if (result.has(parentArtifactId)) continue; // already have latest

        result.set(parentArtifactId, {
            id: pv.id,
            content: pv.content,
            version: pv.version,
            created_at: pv.created_at,
        });
    }

    return result;
}

/**
 * For a list of parent version IDs, find their associated PECP content via the
 * parent_version FK. Returns the latest approved PECP version,
 * keyed by the parent version ID.
 */
export async function loadPECPsForParentVersions(
    em: EntityManager,
    parentVersionIds: string[],
): Promise<Map<string, { id: string; content: string; version: number; created_at: Date }>> {
    if (!parentVersionIds.length) return new Map();

    const pecpVersions = await em.find(
        ArtifactVersionEntity,
        {
            document_type: 'PECP',
            status: 'approved',
            parent_version: { $in: parentVersionIds },
        },
        {
            populate: ['parent_version'],
            orderBy: { version: 'DESC' },
        },
    );

    const result = new Map<string, { id: string; content: string; version: number; created_at: Date }>();

    for (const pecpVersion of pecpVersions) {
        const parentVersionId = pecpVersion.parent_version?.id;
        if (!parentVersionId || !pecpVersion.content) continue;
        if (result.has(parentVersionId)) continue;

        result.set(parentVersionId, {
            id: pecpVersion.id,
            content: pecpVersion.content,
            version: pecpVersion.version,
            created_at: pecpVersion.created_at,
        });
    }

    return result;
}
