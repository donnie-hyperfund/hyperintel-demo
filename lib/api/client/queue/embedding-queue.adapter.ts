/**
 * Embedding Queue
 *
 * Schema and adapters for the embedding queue.
 * Used by both workers (Cloudflare Queue) and local development (HTTP).
 */

import { HttpQueueAdapter, NoopQueueAdapter, QueueAdapter } from '@common/common/queue.adapter';
import { z } from 'zod';

// ============================================================================
// MESSAGE SCHEMAS
// ============================================================================

/**
 * Message sent to the embedding queue when a document is created/updated.
 */
export const IndexVersionMessageSchema = z.object({
    /** Type of operation */
    type: z.literal('index_artifact_version'),
    /** Project ID for the document (null for intake/chat-scoped uploads) */
    projectId: z.string().uuid().nullable(),
    /** Chat ID for chat-scoped embeddings (intake uploads) */
    chatId: z.string().uuid().nullable().optional(),
    /** Artifact version ID to index */
    versionId: z.string().uuid(),
    /** Document content to index */
    content: z.string(),
    /** Optional: document name for logging */
    documentName: z.string().optional(),
    /** Optional: whether this is AI-generated content */
    is_ai_content: z.boolean().optional(),
    /** Preview branch alias — when set, the worker connects to the branch DB instead of main */
    previewAlias: z.string().nullish(),
});

export type IndexVersionMessage = z.infer<typeof IndexVersionMessageSchema>;

/**
 * Batch message for reindexing entire project.
 */
export const ReindexProjectMessageSchema = z.object({
    type: z.literal('reindex_project'),
    projectId: z.string().uuid(),
    /** Preview branch alias — when set, the worker connects to the branch DB instead of main */
    previewAlias: z.string().nullish(),
});

export type ReindexProjectMessage = z.infer<typeof ReindexProjectMessageSchema>;

/**
 * Union of all queue message types.
 */
export const EmbeddingQueueMessageSchema = z.discriminatedUnion('type', [
    IndexVersionMessageSchema,
    ReindexProjectMessageSchema,
]);

export type EmbeddingQueueMessage = z.infer<typeof EmbeddingQueueMessageSchema>;

/**
 * Helper to create the appropriate embedding queue adapter.
 * Local dev: returns MockQueue from workerEnv (in-process).
 * Deployed: HttpAdapter with inferred worker URL.
 *
 * NOTE: the `@/lib/local/cf-env-secret-mock` path is deleted on Vercel; webpack resolution is
 * handled by a `resolve.alias` entry in next.config.mjs that stubs it to `false` when
 * NEXT_PUBLIC_LOCAL_WORKERS is not 'true'. That's why a plain synchronous require() works
 * here — the import never survives into prod bundles.
 */
export function createEmbeddingQueueAdapter(): QueueAdapter<EmbeddingQueueMessage> {
    if (process.env.NEXT_PUBLIC_LOCAL_WORKERS === 'true') {
        const { workerEnv } = require('@/lib/local/cf-env-secret-mock');
        return workerEnv.EMBEDDING_QUEUE as QueueAdapter<EmbeddingQueueMessage>;
    }

    const authSecret = process.env.AUTH_SECRET;
    if (authSecret) {
        const { getWorkerUrl } = require('@/lib/api/requests/worker/common');
        const endpoint = getWorkerUrl('embedding', '/enqueue');
        return new HttpQueueAdapter<EmbeddingQueueMessage>(endpoint, authSecret, 'embedding');
    }

    console.warn('[createEmbeddingQueueAdapter] AUTH_SECRET not configured');
    return new NoopQueueAdapter<EmbeddingQueueMessage>('embedding');
}
