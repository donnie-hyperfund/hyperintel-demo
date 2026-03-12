/**
 * Extraction Worker
 *
 * Consumes hi-extraction-queue. For each uploaded file:
 *   1. Reads the file bytes from R2
 *   2. Routes by mime type:
 *      - docx/pptx → Rust WASM worker (service binding)
 *      - pdf → TODO: browser-renderer worker
 *   3. Stores extracted markdown on the ArtifactVersion
 *   4. Queues embedding for semantic search
 */

import type { MessageBatch } from '@cloudflare/workers-types';
import { CloudflareQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { type ExtractionQueueMessage, ExtractionQueueMessageSchema } from '@common/queue/extraction-queue.adapter';
import type { EntityManager } from '@mikro-orm/postgresql';
import { initInferredContext } from '@worker/context.helpers';
import { Hono } from 'hono';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';

// ============================================================================
// FILETYPE ROUTING
// ============================================================================

type Filetype = 'docx' | 'pptx' | 'pdf';

const MIME_TO_FILETYPE: Record<string, Filetype> = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/pdf': 'pdf',
};

function resolveFiletype(mimeType: string, originalName: string): Filetype | null {
    if (MIME_TO_FILETYPE[mimeType]) return MIME_TO_FILETYPE[mimeType];

    // Fallback: extension-based detection
    const ext = originalName.slice(originalName.lastIndexOf('.')).toLowerCase();
    if (ext === '.docx') return 'docx';
    if (ext === '.pptx') return 'pptx';
    if (ext === '.pdf') return 'pdf';

    return null;
}

// ============================================================================
// EXTRACTION LOGIC
// ============================================================================

interface ExtractionContext {
    env: Env;
    em: EntityManager;
}

function extractMarkdown(fileBytes: ArrayBuffer, filetype: Filetype, env: Env): Promise<string> {
    switch (filetype) {
        case 'docx':
        case 'pptx':
            return extractViaRustWorker(fileBytes, filetype, env);
        case 'pdf':
            // return extractPdf(fileBytes, env);
            return extractViaRustWorker(fileBytes, filetype, env);
        default:
            throw new Error(`Unsupported file type: ${filetype}`);
    }
}

/**
 * Send file bytes to the Rust WASM worker for docx/pptx extraction.
 * Called via service binding — not publicly accessible.
 *
 * TODO: For very large files (>40MB), consider passing the R2 storage key
 * instead of raw bytes and having the Rust worker read from R2 directly.
 * This avoids copying large buffers through the service binding. Typical
 * docx/pptx files are well under this threshold so bytes-in-body is fine for now.
 */
async function extractViaRustWorker(fileBytes: ArrayBuffer, filetype: Filetype, env: Env): Promise<string> {
    const response = await env.EXTRACT_RUST.fetch('http://extract-rust/extract', {
        method: 'POST',
        headers: { 'X-File-Type': filetype },
        body: fileBytes,
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Rust worker returned ${response.status}: ${error}`);
    }

    return response.text();
}

/**
 * Extract text from PDF.
 * TODO: integrate browser-renderer worker from other project.
 */
async function extractPdf(_fileBytes: ArrayBuffer, _env: Env): Promise<string> {
    throw new Error('PDF extraction not yet implemented — pending browser-renderer worker');
}

// ============================================================================
// MESSAGE PROCESSING
// ============================================================================

async function processMessage(
    message: ExtractionQueueMessage,
    ctx: ExtractionContext,
    logPrefix: string,
): Promise<{ success: boolean; error?: string }> {
    switch (message.type) {
        case 'extract_file_content':
            return processExtraction(message, ctx, logPrefix);
        default:
            return { success: false, error: 'Unknown message type' };
    }
}

async function processExtraction(
    message: ExtractionQueueMessage & { type: 'extract_file_content' },
    ctx: ExtractionContext,
    logPrefix: string,
): Promise<{ success: boolean; error?: string }> {
    const { fileId, versionId, storageKey, originalName, mimeType, projectId, chatId } = message;

    console.log(`${logPrefix} Extracting ${originalName} (${mimeType}) from ${storageKey}`);

    // 1. Resolve filetype
    const filetype = resolveFiletype(mimeType, originalName);
    if (!filetype) {
        console.error(`${logPrefix} Unsupported file type: ${mimeType} / ${originalName}`);
        await markFileFailed(ctx.em, fileId, `Unsupported file type: ${mimeType}`);
        return { success: false, error: `Unsupported file type: ${mimeType}` };
    }

    // 2. Read file from R2
    const r2Object = await ctx.env.ARTIFACTS_BUCKET.get(storageKey);
    if (!r2Object) {
        console.error(`${logPrefix} File not found in R2: ${storageKey}`);
        await markFileFailed(ctx.em, fileId, 'File not found in storage');
        return { success: false, error: 'File not found in storage' };
    }

    const fileBytes = await r2Object.arrayBuffer();
    console.log(`${logPrefix} Read ${fileBytes.byteLength} bytes for ${filetype} extraction`);

    // 3. Extract markdown
    let markdown: string;
    try {
        markdown = await extractMarkdown(fileBytes, filetype, ctx.env);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`${logPrefix} Extraction failed:`, errorMsg);
        await markFileFailed(ctx.em, fileId, errorMsg);
        return { success: false, error: errorMsg };
    }

    if (!markdown.trim()) {
        console.warn(`${logPrefix} Extraction produced empty content for ${originalName}`);
        await markFileFailed(ctx.em, fileId, 'Extraction produced empty content');
        return { success: false, error: 'Empty extraction result' };
    }

    console.log(`${logPrefix} Extracted ${markdown.length} chars from ${originalName}`);

    // 4. Update artifact version with extracted content, approve it
    const version = await ctx.em.findOneOrFail(ArtifactVersionEntity, versionId, { populate: ['artifact'] });
    version.content = markdown;
    version.status = 'approved';
    version.status_changed_at = new Date();

    // Also find the parent artifact and set current_version
    version.artifact.current_version = version;

    // Mark file as processed
    const artifactFile = await ctx.em.findOneOrFail(ArtifactFileEntity, fileId);
    artifactFile.status = 'processed';

    await ctx.em.flush();

    // 5. Queue embedding
    if (ctx.env.EMBEDDING_QUEUE) {
        try {
            const embeddingQueue = new CloudflareQueueAdapter(ctx.env.EMBEDDING_QUEUE);
            await embeddingQueue.send({
                type: 'index_artifact_version',
                projectId: projectId ?? null,
                chatId: chatId ?? null,
                versionId,
                content: markdown,
                documentName: originalName,
                is_ai_content: false,
            });
            console.log(`${logPrefix} Queued embedding for ${originalName}`);
        } catch (error) {
            console.error(`${logPrefix} Failed to queue embedding:`, error);
            // Non-fatal — extraction succeeded, embedding can be retried
        }
    }

    return { success: true };
}

async function markFileFailed(em: EntityManager, fileId: string, reason: string) {
    try {
        const file = await em.findOne(ArtifactFileEntity, fileId);
        if (file) {
            file.status = 'error';
            file.extraction_error = reason;
            await em.flush();
        }
    } catch (error) {
        console.error('[extraction] Failed to mark file as failed:', error);
    }
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.json({ status: 'ok', worker: 'extraction' }));
app.get('/health', (c) => c.json({ status: 'healthy' }));

/**
 * HTTP endpoint for local dev / manual triggers.
 */
app.post('/extract', async (c) => {
    const authSecret = await c.env.AUTH_SECRET.get();
    const authHeader = c.req.header('Authorization') ?? '';

    if (!authSecret) return c.json({ error: 'AUTH_SECRET not configured' }, 500);

    const encoder = new TextEncoder();
    const secretBytes = encoder.encode(authSecret);
    const headerBytes = encoder.encode(authHeader);

    if (secretBytes.length !== headerBytes.length) return c.json({ error: 'Unauthorized' }, 403);

    try {
        if (!crypto.subtle.timingSafeEqual(secretBytes, headerBytes)) {
            return c.json({ error: 'Unauthorized' }, 403);
        }
    } catch {
        return c.json({ error: 'Unauthorized' }, 403);
    }

    const body = await c.req.json();
    const parsed = ExtractionQueueMessageSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ error: 'Invalid message format', details: parsed.error.message }, 400);
    }

    const ctx = await initInferredContext(c.env, {}, { withOrm: true });
    if (!ctx.em) return c.json({ error: 'ORM not initialized' }, 500);

    try {
        const result = await processMessage(parsed.data, { env: c.env, em: ctx.em }, '[extraction/http]');
        return c.json(result, result.success ? 200 : 400);
    } catch (error) {
        console.error('[extraction/http] Error:', error);
        return c.json({ error: 'Processing failed', details: String(error) }, 500);
    }
});

// ============================================================================
// QUEUE CONSUMER
// ============================================================================

async function handleQueueBatch(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log(`[extraction/queue] Processing batch of ${batch.messages.length} messages`);

    const ctx = await initInferredContext(env, {}, { withOrm: true });

    if (!ctx.em) {
        console.error('[extraction/queue] ORM not initialized');
        return;
    }

    for (const message of batch.messages) {
        const parsed = ExtractionQueueMessageSchema.safeParse(message.body);
        if (!parsed.success) {
            console.error('[extraction/queue] Invalid message format:', parsed.error.message);
            message.ack();
            continue;
        }

        try {
            const result = await processMessage(parsed.data, { env, em: ctx.em }, '[extraction/queue]');

            if (result.success) {
                message.ack();
            } else {
                console.error('[extraction/queue] Processing failed:', result.error);
                message.ack(); // Ack to prevent infinite retries of unprocessable messages
            }
        } catch (error) {
            console.error('[extraction/queue] Error processing message:', error);
            message.retry();
        }
    }

    if (ctx.em) await ctx.em.flush();
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    fetch: app.fetch,
    queue: handleQueueBatch,
};
