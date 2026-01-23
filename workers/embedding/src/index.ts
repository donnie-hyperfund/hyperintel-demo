/**
 * Embedding Worker
 * 
 * Processes embedding jobs from the queue.
 * Creates semantic embeddings for documents to enable search.
 */

import { Hono } from 'hono';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { MessageBatch } from '@cloudflare/workers-types';
import type { OpenRouter } from '@openrouter/sdk';
import type OpenAI from 'openai';
import { initInferredContext } from '@worker/context.helpers';
import { indexArtifactVersion, reindexProject } from '@/lib/orm/artifacts/artifact.helpers';
import { ArtifactEmbeddingEntity } from '@/lib/orm/entities/artifacts/artifact-embedding.entity';
import { type QueueMessage, QueueMessageSchema } from '@common/queue/embedding-queue.adapter';

// ============================================================================
// SHARED PROCESSING LOGIC
// ============================================================================

interface ProcessingContext {
    openai: OpenAI;
    orouterSdk: OpenRouter;
    em: EntityManager;
}

interface ProcessingResult {
    success: boolean;
    indexed?: number;
    deleted?: number;
    total?: number;
    artifacts?: number;
    error?: string;
}

/**
 * Process a single embedding message.
 * Shared between HTTP and queue handlers.
 */
async function processMessage(
    message: QueueMessage,
    ctx: ProcessingContext,
    logPrefix: string,
): Promise<ProcessingResult> {
    switch (message.type) {
        case 'index_artifact_version': {
            console.log(
                `${logPrefix} Indexing version ${message.versionId} for project ${message.projectId}`,
                message.documentName ? `(${message.documentName})` : '',
            );

            const result = await indexArtifactVersion(
                ctx.openai,
                ctx.orouterSdk,
                ctx.em,
                { id: message.versionId, content: message.content },
                message.projectId,
                ArtifactEmbeddingEntity,
            );

            console.log(
                `${logPrefix} Indexed ${result.indexed} chunks, deleted ${result.deleted} old`,
                message.documentName ? `for ${message.documentName}` : '',
            );

            return { success: true, ...result };
        }

        case 'reindex_project': {
            console.log(`${logPrefix} Reindexing project ${message.projectId}`);

            const result = await reindexProject(
                ctx.openai,
                ctx.orouterSdk,
                ctx.em,
                message.projectId,
                ArtifactEmbeddingEntity,
            );

            console.log(`${logPrefix} Reindexed ${result.total} chunks from ${result.artifacts} artifacts`);

            return { success: true, ...result };
        }

        default:
            return { success: false, error: 'Unknown message type' };
    }
}

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

/**
 * HTTP endpoint for local development.
 * Processes embedding requests directly (bypasses queue).
 */
app.post('/enqueue', async (c) => {
    // Verify auth secret using timing-safe comparison
    const authSecret = await c.env.AUTH_SECRET.get();
    const authHeader = c.req.header('Authorization') ?? '';

    if (!authSecret) {
        return c.json({ error: 'AUTH_SECRET not configured' }, 500);
    }

    // Timing-safe comparison to prevent timing attacks
    const encoder = new TextEncoder();
    const secretBytes = encoder.encode(authSecret);
    const headerBytes = encoder.encode(authHeader);

    // Length check first (timingSafeEqual requires same length)
    if (secretBytes.length !== headerBytes.length) {
        return c.json({ error: 'Unauthorized' }, 403);
    }

    try {
        const isValid = crypto.subtle.timingSafeEqual(secretBytes, headerBytes);
        if (!isValid) {
            return c.json({ error: 'Unauthorized' }, 403);
        }
    } catch {
        return c.json({ error: 'Unauthorized' }, 403);
    }

    // Parse and validate message
    const body = await c.req.json();
    const parsed = QueueMessageSchema.safeParse(body);

    if (!parsed.success) {
        return c.json({ error: 'Invalid message format', details: parsed.error.message }, 400);
    }

    // Initialize context
    const ctx = await initInferredContext(c.env, {}, { withOrm: true });

    if (!ctx.openai || !ctx.orouterSdk || !ctx.em) {
        return c.json({ error: 'Missing AI clients configuration' }, 500);
    }

    try {
        const result = await processMessage(parsed.data, ctx, '[embedding/http]');
        
        if (!result.success) {
            return c.json({ error: result.error }, 400);
        }
        
        return c.json(result);
    } catch (error) {
        console.error('[embedding/http] Error:', error);
        return c.json({ error: 'Processing failed', details: String(error) }, 500);
    }
});

// ============================================================================
// QUEUE CONSUMER
// ============================================================================

async function handleQueueBatch(
    batch: MessageBatch<unknown>,
    env: Env,
    _ctx: ExecutionContext,
): Promise<void> {
    console.log(`[embedding/queue] Processing batch of ${batch.messages.length} messages`);

    // Initialize context with AI clients
    const ctx = await initInferredContext(env, {}, { withOrm: true });

    if (!ctx.openai || !ctx.orouterSdk || !ctx.em) {
        console.error('[embedding/queue] Missing required context: openai, orouterSdk, or em');
        // Retry later by not acking
        return;
    }

    for (const message of batch.messages) {
        // Parse and validate message
        const parsed = QueueMessageSchema.safeParse(message.body);
        if (!parsed.success) {
            console.error('[embedding/queue] Invalid message format:', parsed.error.message);
            message.ack(); // Ack to prevent infinite retries of invalid messages
            continue;
        }

        try {
            const result = await processMessage(parsed.data, ctx, '[embedding/queue]');
            
            if (result.success) {
                message.ack();
            } else {
                console.error('[embedding/queue] Processing failed:', result.error);
                message.ack(); // Ack invalid messages to prevent infinite retries
            }
        } catch (error) {
            console.error('[embedding/queue] Error processing message:', error);
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
