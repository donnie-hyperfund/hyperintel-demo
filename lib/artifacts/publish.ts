/**
 * Artifact Publish Service
 *
 * Copies a project-scoped artifact to user scope on approval.
 * Used for Legacy DNA documents so they can be imported into other projects.
 *
 * - Non-destructive: project-scoped original stays unchanged
 * - Auto-approved: published versions are immediately approved
 * - Upsert: if user-scoped artifact with same key exists, creates new version
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';

export interface PublishToUserScopeParams {
    /** The approved project-scoped version to publish */
    sourceVersion: ArtifactVersionEntity;
    /** The user's internal DB ID (UserEntity.id) */
    userId: string;
    /** Source project ID (for metadata) */
    projectId: string;
    /** Project name — incorporated into the published artifact key */
    projectName: string;
}

export interface PublishResult {
    status: 'published' | 'updated' | 'error';
    artifactId?: string;
    versionId?: string;
    key?: string;
    error?: string;
}

/**
 * Publish a project-scoped artifact version to user scope.
 *
 * If a user-scoped artifact with the same key already exists,
 * creates a new version. Otherwise creates a new artifact.
 */
export async function publishArtifactToUserScope(
    em: EntityManager,
    params: PublishToUserScopeParams,
): Promise<PublishResult> {
    const { sourceVersion, userId, projectId, projectName } = params;
    const sourceArtifact = sourceVersion.artifact;
    const projectSlug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const baseKey = sourceArtifact.key.replace(/\.md$/, '');
    const key = `${baseKey}-${projectSlug}.md`;
    const publishedFrom = { projectId, artifactId: sourceArtifact.id, versionId: sourceVersion.id };

    try {
        const existing = await em.findOne(
            ArtifactEntity,
            { user: userId, project: null, key },
            { populate: ['versions', 'current_version'] },
        );

        if (existing) {
            const versions = existing.versions.getItems();
            const maxVersion = Math.max(...versions.map((v) => v.version), 0);
            const newVersionNum = maxVersion + 1;

            const newVersion = new ArtifactVersionEntity();
            newVersion.artifact = existing;
            newVersion.version = newVersionNum;
            newVersion.content = sourceVersion.content;
            newVersion.ai_content = sourceVersion.ai_content;
            newVersion.is_internal = sourceVersion.is_internal;
            newVersion.document_type = sourceVersion.document_type;
            newVersion.status = 'approved';
            newVersion.status_changed_at = new Date();
            newVersion.status_changed_by = userId;

            em.persist(newVersion);

            existing.version = newVersionNum;
            existing.title = sourceArtifact.title;
            existing.current_version = newVersion;
            existing.metadata = {
                ...existing.metadata,
                publishedFrom,
                lastPublishedAt: new Date().toISOString(),
            };

            await em.flush();

            return { status: 'updated', artifactId: existing.id, versionId: newVersion.id, key };
        }

        // New user-scoped artifact — two-phase insert for circular FK
        let resultArtifactId = '';
        let resultVersionId = '';

        await em.transactional(async (txEm) => {
            // Phase 1: Create artifact
            const artifact = new ArtifactEntity();
            artifact.key = key;
            artifact.title = sourceArtifact.title;
            artifact.version = 1;
            artifact.user = txEm.getReference('UserEntity', userId) as any;
            artifact.metadata = {
                publishedFrom,
                lastPublishedAt: new Date().toISOString(),
            };

            txEm.persist(artifact);
            await txEm.flush();

            // Phase 2: Create approved version
            const version = new ArtifactVersionEntity();
            version.artifact = artifact;
            version.version = 1;
            version.content = sourceVersion.content;
            version.ai_content = sourceVersion.ai_content;
            version.is_internal = sourceVersion.is_internal;
            version.document_type = sourceVersion.document_type;
            version.status = 'approved';
            version.status_changed_at = new Date();
            version.status_changed_by = userId;

            txEm.persist(version);
            await txEm.flush();

            // Phase 3: Set current_version
            artifact.current_version = version;
            await txEm.flush();

            resultArtifactId = artifact.id;
            resultVersionId = version.id;
        });

        return { status: 'published', artifactId: resultArtifactId, versionId: resultVersionId, key };
    } catch (error) {
        console.error('[publishArtifactToUserScope] Failed:', error);
        return {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
