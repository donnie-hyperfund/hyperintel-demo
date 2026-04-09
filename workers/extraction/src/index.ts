/**
 * Extraction Worker
 *
 * Consumes hi-extraction-queue. For each uploaded file:
 *   1. Reads the file bytes from R2
 *   2. Extracts via Rust WASM worker (v2: docx-parser / pptx-to-md with embedded images)
 *   3. If images contain text → re-processes via Reducto OCR
 *   4. Stores extracted markdown on the ArtifactVersion
 *   5. Queues embedding for semantic search
 */

import type { MessageBatch } from '@cloudflare/workers-types';
import { CloudflareQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { type ExtractionQueueMessage, ExtractionQueueMessageSchema } from '@common/queue/extraction-queue.adapter';
import type { EntityManager } from '@mikro-orm/postgresql';
import { initInferredContext } from '@worker/context.helpers';
import { Hono } from 'hono';
import type Reducto from 'reductoai';
import type { ParseResponse } from 'reductoai/resources/shared';
import { toFile } from 'reductoai/uploads';
import { uploadArtifactImage } from '@/lib/artifacts/artifact-images';
import { persistMarkdownImages } from '@/lib/markdown/artifact-images';
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
    reducto?: Reducto;
}

function extractDocument(fileBytes: ArrayBuffer, filetype: Filetype, env: Env): Promise<RustExtractResponse> {
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

/** Response shape from Rust worker v2 */
interface RustExtractResponse {
    content: string;
    imageText: boolean;
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
async function extractViaRustWorker(
    fileBytes: ArrayBuffer,
    filetype: Filetype,
    env: Env,
): Promise<RustExtractResponse> {
    const response = await env.EXTRACT_RUST.fetch('http://extract-rust/extract/v2', {
        method: 'POST',
        headers: { 'X-File-Type': filetype, 'X-Embed-Images': 'true' },
        body: fileBytes,
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Rust worker returned ${response.status}: ${error}`);
    }

    return response.json() as Promise<RustExtractResponse>;
}

const FILETYPE_TO_MIME: Record<Filetype, string> = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pdf: 'application/pdf',
};

/** Max images to persist per document (prevent R2 bloat on huge PDFs) */
const MAX_IMAGES_PER_DOCUMENT = 500;
/** Max images per page (estimated via chunk count) */
const MAX_IMAGES_PER_PAGE = 5;

interface ReductoExtractionResult {
    content: string;
    imageCount: number;
}

/**
 * Upload file to Reducto and parse with OCR.
 * Fetches figure images from Reducto's temporary URLs, persists to R2,
 * and injects `artifact-image://` references into the markdown.
 */
async function extractViaReducto(
    fileBytes: ArrayBuffer,
    filetype: Filetype,
    originalName: string,
    reducto: Reducto,
    r2Bucket: R2Bucket,
    storagePrefix: string,
): Promise<ReductoExtractionResult> {
    const file = await toFile(new Blob([fileBytes], { type: FILETYPE_TO_MIME[filetype] }), originalName);
    const upload = await reducto.upload({ file });

    const result = await reducto.parse.run({
        input: upload,
        formatting: { table_output_format: 'md' },
        enhance: { summarize_figures: true },
        settings: { return_images: ['figure'] },
    });

    if ('job_id' in result && !('result' in result)) {
        throw new Error('Reducto returned async response — sync expected');
    }

    const parseResult = (result as ParseResponse).result;

    let chunks: ParseResponse.FullResult.Chunk[];

    if (parseResult.type === 'full') {
        chunks = parseResult.chunks;
    } else if (parseResult.type === 'url') {
        const res = await fetch(parseResult.url);
        const full = (await res.json()) as ParseResponse.FullResult;
        chunks = full.chunks;
    } else {
        throw new Error('Unexpected Reducto response format');
    }

    // Extract figure images and inject artifact-image:// refs
    const { contents, imageCount } = await processChunksWithImages(chunks, r2Bucket, storagePrefix);
    return { content: contents.join('\n\n'), imageCount };
}

/**
 * Process Reducto chunks: persist figure images to R2, inject artifact-image:// refs.
 */
export async function processChunksWithImages(
    chunks: ParseResponse.FullResult.Chunk[],
    r2Bucket: R2Bucket,
    storagePrefix: string,
): Promise<{ contents: string[]; imageCount: number }> {
    // Collect all figure images across chunks (respecting limits)
    interface FigureRef {
        chunkIndex: number;
        blockIndex: number;
        alt: string;
        imageUrl: string;
    }

    const figures: FigureRef[] = [];
    const perChunkCount = new Map<number, number>();

    for (const [ci, chunk] of chunks.entries()) {
        for (const [bi, block] of chunk.blocks.entries()) {
            if (block.type !== 'Figure' || !block.image_url) continue;
            if (figures.length >= MAX_IMAGES_PER_DOCUMENT) break;

            const chunkCount = perChunkCount.get(ci) ?? 0;
            if (chunkCount >= MAX_IMAGES_PER_PAGE) continue;
            perChunkCount.set(ci, chunkCount + 1);

            figures.push({
                chunkIndex: ci,
                blockIndex: bi,
                alt: block.content.slice(0, 200),
                imageUrl: block.image_url,
            });
        }
    }

    // Fetch + upload all images in parallel
    const uploaded = await Promise.all(
        figures.map(async (fig) => {
            const response = await fetch(fig.imageUrl);
            if (!response.ok) return null;

            const bytes = await response.arrayBuffer();
            const contentType = response.headers.get('content-type') ?? 'image/png';
            const key = await uploadArtifactImage(r2Bucket, storagePrefix, bytes, contentType);
            return { ...fig, key };
        }),
    );

    // Group successful uploads by chunk index
    const byChunk = new Map<number, Array<{ blockIndex: number; alt: string; key: string }>>();
    for (const entry of uploaded) {
        if (!entry) continue;
        const list = byChunk.get(entry.chunkIndex) ?? [];
        list.push(entry);
        byChunk.set(entry.chunkIndex, list);
    }

    // Build final content per chunk from ordered blocks so repeated figure text
    // still maps each uploaded image to the correct figure occurrence.
    const contents = chunks.map((chunk, ci) => {
        const chunkImages = byChunk.get(ci);
        if (!chunkImages) return chunk.content;

        const imagesByBlockIndex = new Map(chunkImages.map((img) => [img.blockIndex, img]));
        const parts: string[] = [];

        for (const [bi, block] of chunk.blocks.entries()) {
            if (block.content) {
                parts.push(block.content);
            }

            const img = imagesByBlockIndex.get(bi);
            if (img) {
                parts.push(`![${img.alt}](artifact-image://${img.key})`);
            }
        }

        return parts.join('\n\n');
    });

    const imageCount = uploaded.filter(Boolean).length;
    return { contents, imageCount };
}

// ============================================================================
// MESSAGE PROCESSING
// ============================================================================

// biome-ignore lint/suspicious/useAwait: delegates to async processExtraction
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

    // 3. Extract via Rust worker (v2 with embedded images + text detection)
    const MIN_CONTENT_LENGTH = 50;
    const imageStoragePrefix = `${storageKey.substring(0, storageKey.lastIndexOf('/'))}/images`;
    let markdown: string;
    try {
        const rustResult = await extractDocument(fileBytes, filetype, ctx.env);
        markdown = rustResult.content;

        const contentTooShort = !markdown.trim() || markdown.trim().length < MIN_CONTENT_LENGTH;
        const needsReducto = rustResult.imageText || contentTooShort;

        if (contentTooShort) {
            console.log(
                `${logPrefix} Content too short (${markdown.trim().length} chars) for ${originalName}, treating as image-heavy document`,
            );
        }

        if (needsReducto && ctx.reducto) {
            console.log(
                `${logPrefix} Re-processing ${originalName} via Reducto OCR (imageText=${rustResult.imageText}, contentTooShort=${contentTooShort})`,
            );
            try {
                const reductoResult = await extractViaReducto(fileBytes, filetype, originalName, ctx.reducto, ctx.env.ARTIFACTS_BUCKET, imageStoragePrefix);
                markdown = reductoResult.content;
                console.log(`${logPrefix} Reducto OCR produced ${markdown.length} chars, ${reductoResult.imageCount} images`);
            } catch (ocrError) {
                console.error(`${logPrefix} Reducto OCR failed, falling back to Rust extraction:`, ocrError);
            }
        } else if (needsReducto) {
            console.warn(`${logPrefix} Needs Reducto but not configured — using Rust extraction`);
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`${logPrefix} Extraction failed:`, errorMsg);

        // Rust extraction completely failed — try Reducto as last resort
        if (ctx.reducto) {
            console.log(`${logPrefix} Attempting Reducto fallback after Rust failure`);
            try {
                const reductoResult = await extractViaReducto(fileBytes, filetype, originalName, ctx.reducto, ctx.env.ARTIFACTS_BUCKET, imageStoragePrefix);
                markdown = reductoResult.content;
                console.log(`${logPrefix} Reducto fallback produced ${markdown.length} chars, ${reductoResult.imageCount} images`);
            } catch (reductoError) {
                console.error(`${logPrefix} Reducto fallback also failed:`, reductoError);
                await markFileFailed(ctx.em, fileId, errorMsg);
                return { success: false, error: errorMsg };
            }
        } else {
            await markFileFailed(ctx.em, fileId, errorMsg);
            return { success: false, error: errorMsg };
        }
    }

    if (!markdown!.trim()) {
        console.warn(`${logPrefix} Extraction produced empty content for ${originalName}`);
        await markFileFailed(ctx.em, fileId, 'Extraction produced empty content');
        return { success: false, error: 'Empty extraction result' };
    }

    // Persist any embedded data: URI images (from Rust extractor) to R2.
    // No-op if markdown has no data: URIs (e.g. Reducto path already handled images).
    markdown = await persistMarkdownImages(markdown, (bytes, contentType) =>
        uploadArtifactImage(ctx.env.ARTIFACTS_BUCKET, imageStoragePrefix, bytes, contentType),
    );

    // Strip null bytes — PostgreSQL text columns reject \0
    markdown = markdown.replaceAll('\0', '');

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
    artifactFile.extracted_content = markdown;

    await ctx.em.flush();

    // 5. Queue embedding (skip for staged uploads — embedding deferred until association)
    if (ctx.env.EMBEDDING_QUEUE && (projectId || chatId)) {
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
                previewAlias: message.previewAlias,
            });
            console.log(`${logPrefix} Queued embedding for ${originalName}`);
        } catch (error) {
            console.error(`${logPrefix} Failed to queue embedding:`, error);
            // Non-fatal — extraction succeeded, embedding can be retried
        }
    } else if (!projectId && !chatId) {
        console.log(`${logPrefix} Staged upload — skipping embedding until association`);
    }

    return { success: true };
}

async function markFileFailed(em: EntityManager, fileId: string, reason: string) {
    try {
        const file = await em.findOne(ArtifactFileEntity, fileId, { populate: ['artifact_version.artifact'] });
        if (file) {
            file.status = 'error';
            file.extraction_error = reason;

            // Soft-delete so the artifact doesn't appear in listings
            const version = file.artifact_version;
            if (version && version.status === 'proposed') {
                version.status = 'deleted';
                version.status_changed_at = new Date();

                if (!version.artifact.current_version) {
                    version.artifact.current_version = version;
                }
            }

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
        const result = await processMessage(
            parsed.data,
            { env: c.env, em: ctx.em, reducto: ctx.reducto },
            '[extraction/http]',
        );
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

    // Cache contexts per preview alias (different branches need different DB connections)
    const contextCache = new Map<string, { em: EntityManager; reducto?: Reducto }>();

    async function getExtractionContext(previewAlias?: string | null) {
        const key = previewAlias ?? '__main__';
        const cached = contextCache.get(key);
        if (cached) return cached;

        const ctx = await initInferredContext(env, {}, { withOrm: true, previewAlias });
        if (!ctx.em) return null;

        const extractionCtx = { em: ctx.em, reducto: ctx.reducto };
        contextCache.set(key, extractionCtx);
        return extractionCtx;
    }

    for (const message of batch.messages) {
        const parsed = ExtractionQueueMessageSchema.safeParse(message.body);
        if (!parsed.success) {
            console.error('[extraction/queue] Invalid message format:', parsed.error.message);
            message.ack();
            continue;
        }

        const extractionCtx = await getExtractionContext(parsed.data.previewAlias);
        if (!extractionCtx) {
            console.error('[extraction/queue] ORM not initialized');
            message.retry();
            continue;
        }

        try {
            const result = await processMessage(parsed.data, { env, ...extractionCtx }, '[extraction/queue]');

            if (result.success) {
                message.ack();
            } else {
                console.error('[extraction/queue] Processing failed:', result.error);
                // processMessage already calls markFileFailed — just ack
                message.ack();
            }
        } catch (error) {
            console.error('[extraction/queue] Unexpected error:', error);
            // Mark file as failed so it doesn't stay stuck in "uploading" forever
            try {
                await markFileFailed(
                    extractionCtx.em,
                    parsed.data.fileId,
                    `Queue processing error: ${error instanceof Error ? error.message : String(error)}`,
                );
            } catch (markError) {
                console.error('[extraction/queue] Failed to mark file as errored:', markError);
            }
            message.ack();
        }

        if (extractionCtx.em) await extractionCtx.em.flush();
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    fetch: app.fetch,
    queue: handleQueueBatch,
};
