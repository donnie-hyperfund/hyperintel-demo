import type { EntityManager } from '@mikro-orm/postgresql';
import type { OpenRouter } from '@openrouter/sdk';
import type { OpenAI } from '@worker/vendor/openai';
import type { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ArtifactEmbeddingEntity } from '@/lib/orm/entities/artifacts/artifact-embedding.entity';
import { embedTexts } from '@worker/vendor/openrouter-embeddings';
import { chunkContent } from '@worker/utils/llm-chunker';

export async function indexArtifactVersion(
    openaiClient: OpenAI,
    openrouterClient: OpenRouter,
    em: EntityManager,
    artifactVersion: ArtifactVersionEntity,
    projectId: string,
): Promise<{ indexed: number; deleted: number }> {
    const deleted = await em.nativeDelete(ArtifactEmbeddingEntity, {
        artifact_version: artifactVersion.id,
    });

    const chunks = await chunkContent(openrouterClient, artifactVersion.content);
    if (chunks.length === 0) {
        return { indexed: 0, deleted };
    }

    const chunkTexts = chunks.map((c) => c.content);
    const embeddingVectors = await embedTexts(openaiClient, chunkTexts);

    const entities = chunks.map((chunk, index) => {
        const entity = new ArtifactEmbeddingEntity();
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

    await em.nativeDelete(ArtifactEmbeddingEntity, { project: projectId });

    let total = 0;
    for (const artifact of artifacts) {
        const chunks = await chunkContent(openrouterClient, artifact.content);
        if (chunks.length === 0) continue;

        const chunkTexts = chunks.map((c) => c.content);
        const embeddingVectors = await embedTexts(openaiClient, chunkTexts);

        const entities = chunks.map((chunk, index) => {
            const entity = new ArtifactEmbeddingEntity();
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
