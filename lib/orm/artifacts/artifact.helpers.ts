import { embedTexts } from '@common/ai/embeddings';
import { chunkContent } from '@common/ai/utils/chunking';
import type { Nullable } from '@/common/orm/utils';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { OpenRouter } from '@openrouter/sdk';
import type OpenAI from 'openai';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import type { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import type { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import type { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';

export interface ArtifactVersionLike {
    id: string;
    content: string;
}

export interface ArtifactEmbeddingEntityConstructor {
    new (): {
        artifact_version: ArtifactVersionEntity;
        project?: Nullable<ProjectEntity>;
        chat?: Nullable<ChatEntity>;
        chunk_index: number;
        chunk_content: string;
        start_line: number;
        end_line: number;
        embedding: number[];
    };
}

/** Escape string for PostgreSQL - prevents SQL injection */
function escapeSqlString(str: string): string {
    return str.replace(/'/g, "''");
}

export interface IndexArtifactVersionScope {
    projectId?: string | null;
    chatId?: string | null;
}

export async function indexArtifactVersion(
    openaiClient: OpenAI,
    openrouterClient: OpenRouter,
    em: EntityManager,
    artifactVersion: ArtifactVersionLike,
    projectIdOrScope: string | IndexArtifactVersionScope,
    EmbeddingEntity: ArtifactEmbeddingEntityConstructor,
    is_ai_content: boolean,
): Promise<{ indexed: number; deleted: number }> {
    // Support both legacy string projectId and new scope object
    const scope: IndexArtifactVersionScope = typeof projectIdOrScope === 'string'
        ? { projectId: projectIdOrScope }
        : projectIdOrScope;

    const deleted = await em.nativeDelete(EmbeddingEntity, {
        artifact_version: artifactVersion.id,
    });

    // Verify the artifact version still exists (it may have been deleted between enqueue and processing)
    const exists = await em.getConnection().execute(
        `SELECT 1 FROM artifact_versions WHERE id = '${artifactVersion.id}' LIMIT 1`,
    );
    if (exists.length === 0) {
        return { indexed: 0, deleted };
    }

    const chunks = await chunkContent(openrouterClient, artifactVersion.content);
    if (chunks.length === 0) {
        return { indexed: 0, deleted };
    }

    const chunkTexts = chunks.map((c) => c.content);
    const embeddingVectors = await embedTexts(openaiClient, chunkTexts);

    const projectVal = scope.projectId ? `'${scope.projectId}'` : 'NULL';
    const chatVal = scope.chatId ? `'${scope.chatId}'` : 'NULL';

    // Use raw SQL INSERT with direct interpolation (parameterized queries don't work in this environment)
    const conn = em.getConnection();
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddingVectors[i];
        const embeddingStr = `[${embedding.join(',')}]`;
        const escapedContent = escapeSqlString(chunk.content);

        await conn.execute(
            `INSERT INTO artifact_embeddings (artifact_version_id, project_id, chat_id, chunk_index, chunk_content, start_line, end_line, embedding, is_ai_content)
             VALUES ('${artifactVersion.id}', ${projectVal}, ${chatVal}, ${i}, '${escapedContent}', ${chunk.start_line}, ${chunk.end_line}, '${embeddingStr}'::vector, ${is_ai_content})`,
        );
    }

    return { indexed: chunks.length, deleted };
}

// TODO re-index ai_content too.
export async function reindexProject(
    openaiClient: OpenAI,
    openrouterClient: OpenRouter,
    em: EntityManager,
    projectId: string,
    EmbeddingEntity: ArtifactEmbeddingEntityConstructor,
): Promise<{ total: number; artifacts: number }> {
    const artifacts = (await em.getConnection().execute(
        `
        SELECT av.id, av.content, a.project_id
        FROM artifact_versions av
        JOIN artifacts a ON av.artifact_id = a.id
        WHERE a.project_id = $1
          AND av.id = a.current_version_id
          AND av.status = 'approved'
        `,
        [projectId],
    )) as Array<{ id: string; content: string; project_id: string }>;

    await em.nativeDelete(EmbeddingEntity, { project: projectId });

    let total = 0;
    for (const artifact of artifacts) {
        const chunks = await chunkContent(openrouterClient, artifact.content);
        if (chunks.length === 0) continue;

        const chunkTexts = chunks.map((c) => c.content);
        const embeddingVectors = await embedTexts(openaiClient, chunkTexts);

        // Use raw SQL INSERT with direct interpolation (parameterized queries don't work in this environment)
        const conn = em.getConnection();
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const embedding = embeddingVectors[i];
            const embeddingStr = `[${embedding.join(',')}]`;
            const escapedContent = escapeSqlString(chunk.content);

            await conn.execute(
                `INSERT INTO artifact_embeddings (artifact_version_id, project_id, chunk_index, chunk_content, start_line, end_line, embedding)
                 VALUES ('${artifact.id}', '${projectId}', ${i}, '${escapedContent}', ${chunk.start_line}, ${chunk.end_line}, '${embeddingStr}'::vector)`,
            );
        }
        total += chunks.length;
    }

    return { total, artifacts: artifacts.length };
}
