import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import { embedTexts } from '@common/ai/embeddings';
import type { EntityManager } from '@mikro-orm/postgresql';
import type OpenAI from 'openai';
import { z } from 'zod';
import type { Ctx } from '../context';

/** Escape string for PostgreSQL - prevents SQL injection */
function escapeSqlString(str: string): string {
    return str.replace(/'/g, "''");
}

export interface KnowledgeSearchContext {
    em: EntityManager;
    projectId: string;
}

type SearchResult = {
    chunk_content: string;
    chunk_index: number;
    artifact_id: string;
    title: string;
    key: string;
    similarity: number;
};

async function searchKnowledge(
    query: string,
    projectId: string,
    client: OpenAI,
    em: EntityManager,
    limit: number,
    minSimilarity: number,
): Promise<SearchResult[]> {
    const [queryEmbedding] = await embedTexts(client, [query]);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;
    const escapedProjectId = escapeSqlString(projectId);

    // Use direct interpolation - parameterized queries don't work in CF Workers environment
    const results = (await em.getConnection().execute(
        `
        SELECT
            ae.chunk_content,
            ae.chunk_index,
            av.artifact_id,
            a.title,
            a.key,
            1 - (ae.embedding <=> '${embeddingStr}'::vector) as similarity
        FROM artifact_embeddings ae
        JOIN artifact_versions av ON ae.artifact_version_id = av.id
        JOIN artifacts a ON av.artifact_id = a.id
        WHERE ae.project_id = '${escapedProjectId}'
          AND av.audience = 'ai'
          AND 1 - (ae.embedding <=> '${embeddingStr}'::vector) >= ${minSimilarity}
        ORDER BY ae.embedding <=> '${embeddingStr}'::vector
        LIMIT ${limit}
        `,
    )) as SearchResult[];

    return results;
}

function formatSearchResults(results: SearchResult[]): string {
    if (results.length === 0) {
        return 'No relevant documents found.';
    }

    const grouped = new Map<string, { title: string; key: string; chunks: SearchResult[] }>();

    for (const r of results) {
        const existing = grouped.get(r.artifact_id);
        if (existing) {
            existing.chunks.push(r);
        } else {
            grouped.set(r.artifact_id, { title: r.title, key: r.key, chunks: [r] });
        }
    }

    const parts: string[] = [];
    for (const [, { title, key, chunks }] of grouped) {
        const sortedChunks = chunks.sort((a, b) => a.chunk_index - b.chunk_index);
        const content = sortedChunks.map((c) => c.chunk_content).join('\n...\n');
        const avgSimilarity = (chunks.reduce((sum, c) => sum + c.similarity, 0) / chunks.length).toFixed(2);

        parts.push(`## ${title} (${key})\n**Relevance:** ${avgSimilarity}\n\n${content}`);
    }

    return parts.join('\n\n---\n\n');
}

const SearchKnowledgeParams = z.object({
    query: z.string().describe('Natural language query to search for in project documents'),
    limit: z.number().int().min(1).max(20).default(5).describe('Maximum number of results'),
});

export const KnowledgeSearchToolGroup: AgentToolGroup = {
    slug: 'knowledge',
    name: 'Knowledge Base',
    description: 'Tools for searching and retrieving information from project documents.',
    guidance:
        'Use search_knowledge to find relevant information from project documents. Use list_documents to see all available documents.',
    tools: ['search_knowledge', 'list_documents'],
};

export function createKnowledgeTools() {
    return [
        {
            name: 'search_knowledge' as const,
            description:
                'Search project knowledge base using semantic similarity. Use this to find relevant information from previously created documents and artifacts.',
            parameters: SearchKnowledgeParams,
            executor: async (
                input: { query: string; limit?: number },
                ctx: KnowledgeSearchContext,
                eCtx?: Ctx,
            ): Promise<string> => {
                if (!eCtx?.openai) {
                    return 'Semantic search is not available - OpenAI client not configured.';
                }

                const { query, limit = 5 } = input;

                const results = await searchKnowledge(query, ctx.projectId, eCtx.openai, ctx.em, limit, 0.3);

                return formatSearchResults(results);
            },
        },
    ] as const;
}

export const knowledgeTools = createKnowledgeTools();
