/**
 * Artifact Import Service
 *
 * Copies user-scoped or public artifacts into a project scope.
 * Used when creating a project from intake results (CPF/HPF)
 * and for auto-importing public artifacts (e.g. Company Profile).
 *
 * - Non-destructive: originals stay in their source scope
 * - Auto-approved: imported versions are immediately approved
 * - Duplicate-safe: skips artifacts whose key already exists in the target project
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { SHARED_DOCUMENT_TYPES } from '@/lib/schema/artifact';

export interface ImportDetail {
    sourceArtifactId: string;
    newArtifactId?: string;
    newVersionId?: string;
    key: string;
    content?: string;
    status: 'imported' | 'skipped_duplicate' | 'error';
    error?: string;
}

export interface ImportResult {
    imported: number;
    skipped: number;
    details: ImportDetail[];
}

/**
 * Copy user-scoped artifacts into a project.
 *
 * For each artifact ID:
 * 1. Load source (must be user-scoped, owned by userId)
 * 2. Pick latest approved version (only approved versions can be imported)
 * 3. Skip if key already exists in target project
 * 4. Create project-scoped artifact + approved version in a transaction
 */
export async function importArtifactsToProject(
    em: EntityManager,
    userId: string,
    projectId: string,
    artifactIds: string[],
): Promise<ImportResult> {
    const details: ImportDetail[] = [];
    let imported = 0;
    let skipped = 0;

    // Load all source artifacts in one query
    // Own artifacts always allowed; other users' artifacts only for shared document types
    const sources = await em.find(
        ArtifactEntity,
        {
            id: { $in: artifactIds },
            project: null,
            $or: [{ user: userId }, { current_version: { document_type: { $in: [...SHARED_DOCUMENT_TYPES] } } }],
        },
        { populate: ['versions', 'current_version'] },
    );

    const sourceMap = new Map(sources.map((a) => [a.id, a]));

    // Check which keys already exist in the target project
    const sourceKeys = sources.map((a) => a.key);
    const existingInProject =
        sourceKeys.length > 0 ? await em.find(ArtifactEntity, { project: projectId, key: { $in: sourceKeys } }) : [];
    const existingKeys = new Set(existingInProject.map((a) => a.key));

    await em.transactional(async (txEm) => {
        for (const artifactId of artifactIds) {
            const source = sourceMap.get(artifactId);

            if (!source) {
                details.push({
                    sourceArtifactId: artifactId,
                    key: 'unknown',
                    status: 'error',
                    error: 'Artifact not found or not owned by user',
                });
                skipped++;
                continue;
            }

            if (existingKeys.has(source.key)) {
                details.push({
                    sourceArtifactId: artifactId,
                    key: source.key,
                    status: 'skipped_duplicate',
                });
                skipped++;
                continue;
            }

            // Skip artifacts that were originally published from this project
            const publishedFrom = source.metadata?.publishedFrom as { projectId?: string } | undefined;
            if (publishedFrom?.projectId === projectId) {
                details.push({
                    sourceArtifactId: artifactId,
                    key: source.key,
                    status: 'skipped_duplicate',
                });
                skipped++;
                continue;
            }

            // Find best version: latest approved by version number
            const versions = source.versions.getItems();
            const bestVersion = versions
                .filter((v) => v.status === 'approved')
                .sort((a, b) => b.version - a.version)[0];

            if (!bestVersion) {
                details.push({
                    sourceArtifactId: artifactId,
                    key: source.key,
                    status: 'error',
                    error: 'No approved version found — resource must be approved before importing',
                });
                skipped++;
                continue;
            }

            // Phase 1: Create artifact
            const artifact = new ArtifactEntity();
            artifact.key = source.key;
            artifact.title = source.title;
            artifact.version = 1;
            artifact.project = txEm.getReference('ProjectEntity', projectId) as any;
            const metadata: Record<string, unknown> = { importedFrom: artifactId };
            // Track the originating chat only for own imports — the importing user has access to it.
            // Agent-created artifacts store chat on the version; intake uploads store it on the artifact.
            if (source.user?.id === userId) {
                const originChatId = bestVersion.chat?.id ?? source.chat?.id;
                if (originChatId) metadata.sourceChatId = originChatId;
            }
            artifact.metadata = metadata;

            txEm.persist(artifact);
            await txEm.flush();

            // Phase 2: Create approved version
            const version = new ArtifactVersionEntity();
            version.artifact = artifact;
            version.version = 1;
            version.content = bestVersion.content;
            version.document_type = bestVersion.document_type;
            version.is_internal = bestVersion.is_internal;
            version.status = 'approved';
            version.status_changed_at = new Date();
            version.status_changed_by = userId;

            txEm.persist(version);
            await txEm.flush();

            // Phase 3: Set current_version
            artifact.current_version = version;
            await txEm.flush();

            // Prevent duplicate key in this batch
            existingKeys.add(source.key);

            details.push({
                sourceArtifactId: artifactId,
                newArtifactId: artifact.id,
                newVersionId: version.id,
                key: source.key,
                content: bestVersion.content,
                status: 'imported',
            });
            imported++;
        }
    });

    return { imported, skipped, details };
}

/**
 * Copy all public artifacts (is_public=true) into a project.
 *
 * Called automatically when a project is created.
 * Only imports public artifacts that have an approved version
 * and whose key doesn't already exist in the target project.
 */
export async function importPublicArtifactsToProject(em: EntityManager, projectId: string): Promise<ImportResult> {
    const details: ImportDetail[] = [];
    let imported = 0;
    let skipped = 0;

    // Find all public artifacts with their versions
    const publicArtifacts = await em.find(ArtifactEntity, { is_public: true }, { populate: ['versions'] });

    if (publicArtifacts.length === 0) {
        return { imported: 0, skipped: 0, details: [] };
    }

    // Check which keys already exist in the target project
    const sourceKeys = publicArtifacts.map((a) => a.key);
    const existingInProject = await em.find(ArtifactEntity, { project: projectId, key: { $in: sourceKeys } });
    const existingKeys = new Set(existingInProject.map((a) => a.key));

    await em.transactional(async (txEm) => {
        for (const source of publicArtifacts) {
            if (existingKeys.has(source.key)) {
                details.push({
                    sourceArtifactId: source.id,
                    key: source.key,
                    status: 'skipped_duplicate',
                });
                skipped++;
                continue;
            }

            // Find best version: latest approved
            const versions = source.versions.getItems();
            const bestVersion = versions
                .filter((v) => v.status === 'approved')
                .sort((a, b) => b.version - a.version)[0];

            if (!bestVersion) {
                details.push({
                    sourceArtifactId: source.id,
                    key: source.key,
                    status: 'error',
                    error: 'No approved version found — public artifact must be approved before importing',
                });
                skipped++;
                continue;
            }

            // Phase 1: Create project-scoped artifact
            const artifact = new ArtifactEntity();
            artifact.key = source.key;
            artifact.title = source.title;
            artifact.version = 1;
            artifact.project = txEm.getReference('ProjectEntity', projectId) as any;
            artifact.metadata = { importedFrom: source.id, importedFromPublic: true };

            txEm.persist(artifact);
            await txEm.flush();

            // Phase 2: Create approved version
            const version = new ArtifactVersionEntity();
            version.artifact = artifact;
            version.version = 1;
            version.content = bestVersion.content;
            version.document_type = bestVersion.document_type;
            version.is_internal = bestVersion.is_internal;
            version.status = 'approved';
            version.status_changed_at = new Date();

            txEm.persist(version);
            await txEm.flush();

            // Phase 3: Set current_version
            artifact.current_version = version;
            await txEm.flush();

            existingKeys.add(source.key);

            details.push({
                sourceArtifactId: source.id,
                newArtifactId: artifact.id,
                newVersionId: version.id,
                key: source.key,
                content: bestVersion.content,
                status: 'imported',
            });
            imported++;
        }
    });

    return { imported, skipped, details };
}
