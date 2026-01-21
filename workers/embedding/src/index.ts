/**
 * Embedding Worker
 * 
 * Processes embedding jobs from the queue.
 * Creates semantic embeddings for documents to enable search.
 */

import { Hono } from 'hono';
import type { MessageBatch } from '@cloudflare/workers-types';
import { initInferredContext } from '@worker/context.helpers';
import { indexArtifactVersion, reindexProject } from '@/lib/orm/artifacts/artifact.helpers';
import { ArtifactEmbeddingEntity } from '@/lib/orm/entities/artifacts/artifact-embedding.entity';
import { type QueueMessage, QueueMessageSchema } from './schema';

// ============================================================================
// HTTP HANDLER (health checks, manual triggers)
// ============================================================================

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
    return c.json({ status: 'ok', worker: 'embedding' });
});

app.get('/health', (c) => {
    return c.json({ status: 'healthy' });
});

// ============================================================================
// QUEUE CONSUMER
// ============================================================================

async function handleQueueBatch(
    batch: MessageBatch<unknown>,
    env: Env,
    _ctx: ExecutionContext,
): Promise<void> {
    console.log(`[embedding] Processing batch of ${batch.messages.length} messages`);

    // Initialize context with AI clients
    const ctx = await initInferredContext(env, {}, { withOrm: true });

    if (!ctx.openai || !ctx.orouterSdk || !ctx.em) {
        console.error('[embedding] Missing required context: openai, orouterSdk, or em');
        // Retry later by not acking
        return;
    }

    for (const message of batch.messages) {
        try {
            // Parse and validate message
            const parsed = QueueMessageSchema.safeParse(message.body);
            if (!parsed.success) {
                console.error('[embedding] Invalid message format:', parsed.error.message);
                message.ack(); // Ack to prevent infinite retries of invalid messages
                continue;
            }

            const queueMessage = parsed.data;

            switch (queueMessage.type) {
                case 'index_artifact_version': {
                    console.log(
                        `[embedding] Indexing version ${queueMessage.versionId} for project ${queueMessage.projectId}`,
                        queueMessage.documentName ? `(${queueMessage.documentName})` : '',
                    );

                    const result = await indexArtifactVersion(
                        ctx.openai,
                        ctx.orouterSdk,
                        ctx.em,
                        { id: queueMessage.versionId, content: queueMessage.content },
                        queueMessage.projectId,
                        ArtifactEmbeddingEntity,
                    );

                    console.log(
                        `[embedding] Indexed ${result.indexed} chunks, deleted ${result.deleted} old`,
                        queueMessage.documentName ? `for ${queueMessage.documentName}` : '',
                    );

                    message.ack();
                    break;
                }

                case 'reindex_project': {
                    console.log(`[embedding] Reindexing project ${queueMessage.projectId}`);

                    const result = await reindexProject(
                        ctx.openai,
                        ctx.orouterSdk,
                        ctx.em,
                        queueMessage.projectId,
                        ArtifactEmbeddingEntity,
                    );

                    console.log(
                        `[embedding] Reindexed ${result.total} chunks from ${result.artifacts} artifacts`,
                    );

                    message.ack();
                    break;
                }

                default:
                    console.error('[embedding] Unknown message type');
                    message.ack();
            }
        } catch (error) {
            console.error('[embedding] Error processing message:', error);
            // Don't ack - message will be retried
            message.retry();
        }
    }

    // Flush any pending ORM operations
    if (ctx.em) {
        await ctx.em.flush();
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    fetch: app.fetch,
    queue: handleQueueBatch,
};
