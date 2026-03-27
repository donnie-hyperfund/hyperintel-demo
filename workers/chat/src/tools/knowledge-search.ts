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
    /** Project scope — for project chats */
    projectId?: string;
    /** Chat scope — for intake chats */
    chatId?: string;
}

type SearchResult = {
    chunk_content: string;
    chunk_index: number;
    artifact_id: string;
    title: string;
    key: string;
    similarity: number;
};

interface SearchScope {
    projectId?: string;
    chatId?: string;
}

async function searchKnowledge(
    query: string,
    scope: SearchScope,
    client: OpenAI,
    em: EntityManager,
    limit: number,
    minSimilarity: number,
): Promise<SearchResult[]> {
    const [queryEmbedding] = await embedTexts(client, [query]);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Build scope filter: project-scoped OR chat-scoped
    let scopeFilter: string;
    if (scope.projectId) {
        const escapedProjectId = escapeSqlString(scope.projectId);
        scopeFilter = `ae.project_id = '${escapedProjectId}'`;
    } else if (scope.chatId) {
        const escapedChatId = escapeSqlString(scope.chatId);
        scopeFilter = `ae.chat_id = '${escapedChatId}'`;
    } else {
        return [];
    }

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
        WHERE ${scopeFilter}
          AND av.status = 'approved'
          AND a.current_version_id = av.id
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
    guidance: `Use search_knowledge to find relevant information from project documents. Use list_documents to see all available documents.

**CRITICAL: At the START of every new conversation or phase/stage, you MUST call search_knowledge FIRST to gather relevant context from previous work before responding to the user.** This ensures continuity across phases and prevents redundant work.

**When the user's message contains uploaded files** (indicated by \`::upload[filename]{size=...}\` directives):
- Recently uploaded files may NOT yet appear in \`search_knowledge\` results because semantic indexing runs asynchronously.
- Use \`list_documents\` first to find the uploaded file, then \`read_document\` to access its content.

**When the user asks about a specific file or document:**
1. First use \`search_knowledge\` with a relevant query to find it by content similarity.
2. If no relevant results, use \`list_documents\` to browse all available documents and find the correct name.
3. Then use \`read_document\` with the exact name to view the full content.
Never guess document names — always discover them via search or listing first.`,
    tools: ['search_knowledge', 'list_documents'],
};

export function createKnowledgeTools() {
    return [
        {
            name: 'search_knowledge' as const,
            description:
                'Search knowledge base using semantic similarity. Use this to find relevant information from previously created or uploaded documents and artifacts. MUST be called at the start of every new conversation/phase/stage to gather context.',
            parameters: SearchKnowledgeParams,
            executor: async (
                input: { query: string; limit?: number },
                ctx: KnowledgeSearchContext,
                eCtx?: Ctx,
            ): Promise<string> => {
                if (!eCtx?.openai) {
                    return 'Semantic search is not available - OpenAI client not configured.';
                }

                if (!ctx.projectId && !ctx.chatId) {
                    return 'No search scope available — neither project nor chat context set.';
                }

                const { query, limit = 5 } = input;
                const scope: SearchScope = { projectId: ctx.projectId, chatId: ctx.chatId };

                const results = await searchKnowledge(query, scope, eCtx.openai, ctx.em, limit, 0.3);

                return formatSearchResults(results);
            },
        },
    ] as const;
}

export const knowledgeTools = createKnowledgeTools();
