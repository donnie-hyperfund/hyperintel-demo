import type { EntityManager } from '@mikro-orm/postgresql';
import type { OpenRouter } from '@openrouter/sdk';
import type OpenAI from 'openai';
import { embedTexts } from '@common/ai/embeddings';
import { chunkContent } from '@common/ai/utils/chunking';

export interface ArtifactVersionLike {
    id: string;
    content: string;
}

export interface ArtifactEmbeddingEntityConstructor {
    new (): {
        artifact_version: any;
        project: any;
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

export async function indexArtifactVersion(
    openaiClient: OpenAI,
    openrouterClient: OpenRouter,
    em: EntityManager,
    artifactVersion: ArtifactVersionLike,
    projectId: string,
    EmbeddingEntity: ArtifactEmbeddingEntityConstructor,
): Promise<{ indexed: number; deleted: number }> {
    const deleted = await em.nativeDelete(EmbeddingEntity, {
        artifact_version: artifactVersion.id,
    });

    const chunks = await chunkContent(openrouterClient, artifactVersion.content);
    if (chunks.length === 0) {
        return { indexed: 0, deleted };
    }

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
             VALUES ('${artifactVersion.id}', '${projectId}', ${i}, '${escapedContent}', ${chunk.start_line}, ${chunk.end_line}, '${embeddingStr}'::vector)`,
        );
    }

    return { indexed: chunks.length, deleted };
}

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
