import { embedTexts } from '@common/ai/embeddings';
import { chunkContent } from '@common/ai/utils/chunking';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { OpenRouter } from '@openrouter/sdk';
import type OpenAI from 'openai';

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

    const entities = chunks.map((chunk, index) => {
        const entity = new EmbeddingEntity();
        entity.artifact_version = artifactVersion;
        entity.project = { id: projectId } as any;
        entity.chunk_index = index;
        entity.chunk_content = chunk.content;
        entity.start_line = chunk.start_line;
        entity.end_line = chunk.end_line;
        entity.embedding = embeddingVectors[index];
        return entity;
    });

    await em.persistAndFlush(entities);

    return { indexed: entities.length, deleted };
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

        const entities = chunks.map((chunk, index) => {
            const entity = new EmbeddingEntity();
            entity.artifact_version = { id: artifact.id } as any;
            entity.project = { id: projectId } as any;
            entity.chunk_index = index;
            entity.chunk_content = chunk.content;
            entity.start_line = chunk.start_line;
            entity.end_line = chunk.end_line;
            entity.embedding = embeddingVectors[index];
            return entity;
        });

        await em.persistAndFlush(entities);
        total += entities.length;
    }

    return { total, artifacts: artifacts.length };
}
