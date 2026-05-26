/**
 * Shared streaming utilities for agent chat handlers.
 *
 * Small helpers reused by chat-handler, intake-handler, and phase transition.
 * NOT a mega-abstraction — each handler keeps its own stream loop
 * and done_ext handling.
 */

import type { AgentStreamEvent } from '@common/ai/agent';
import type { ContentPart, ImageContentPart } from '@common/ai/inference/types';
import { serializeException, stringifyError } from '@/common/ai/utils';
import { signArtifactImageKeys } from '@/lib/artifacts/artifact-images';
import { buildArtifactImageContentParts } from '@/lib/markdown/artifact-images';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import type { StreamEvent } from '@/lib/schema/stream';
import type { Ctx } from '../context';
import { generateSignedImageUrls } from '../uploads/image-uploader';
import type { ChatStreamDOStub, UserGatewayStub } from './do-stubs';
import {
    buildStoredErrorMetadata,
    buildWorkerErrorLogContext,
    classifyWorkerError,
    logWorkerError,
    type StoredErrorMetadata,
} from './error-metadata';

// ============================================================================
// DO LIFECYCLE HELPERS
// ============================================================================

/**
 * Wire a ChatStreamDO to an AbortController via long-polling.
 * Starts an async loop that calls abortWait() and triggers the controller.
 */
export function wireAbort(streamDO: ChatStreamDOStub): AbortController {
    const abortController = new AbortController();
    void (async () => {
        try {
            let signal: 'abort' | 'timeout' | 'done';
            do {
                signal = await streamDO.abortWait();
            } while (signal === 'timeout');
            if (signal === 'abort') abortController.abort();
        } catch {
            // DO evicted or RPC failed — abort to prevent hanging generation
            abortController.abort();
        }
    })();
    return abortController;
}

type Enqueue = (data: object | string) => void;

// ============================================================================
// SSE HELPERS
// ============================================================================

export function createEnqueue(controller: ReadableStreamDefaultController<Uint8Array>): Enqueue {
    const encoder = new TextEncoder();
    return (data: object | string) => {
        try {
            const payload = typeof data === 'string' ? data : JSON.stringify(data);
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            return true;
        } catch {
            // Client disconnected — swallow. The handler must keep running
            // to reach done_ext and persist to DB regardless.
        }
        return false;
    };
}

// ============================================================================
// COMMON STREAM EVENT HANDLER
// ============================================================================

/**
 * Handle common agent stream events that are identical across all handlers.
 * Returns true if the event was handled, false if the caller should handle it.
 *
 * Handles: delta, tool_start, tool_result, done, status_update, error,
 *          search_start, search_results, citation, reasoning_*, retry_attempt
 *
 * Does NOT handle: done_ext (endpoint-specific persistence logic)
 */
export interface CommonStreamEventOpts {
    /**
     * Returns true if the currently-active document draft is internal.
     * Used to redact write/patch/edit_document `tool_call_complete` inputs at source
     * so internal content never crosses the wire to FE/DO.
     */
    isCurrentDraftInternal?: () => boolean;
}

const DOC_TOOLS_WITH_CONTENT_INPUT = ['write_document', 'patch_document', 'edit_document'];

export function handleCommonStreamEvent(
    enqueue: Enqueue,
    event: AgentStreamEvent,
    state: { wasTool: boolean },
    opts?: CommonStreamEventOpts,
): boolean {
    switch (event.type) {
        case 'delta':
            if (state.wasTool) {
                enqueue({ type: 'delta', text: '\n\n' });
                state.wasTool = false;
            }
            enqueue({ type: 'delta', text: event.content });
            return true;

        case 'tool_start':
            state.wasTool = true;
            enqueue({ type: 'tool_start', tool: event.tool, id: event.id, offsetMs: event.offsetMs });
            return true;

        case 'tool_call_complete': {
            // Redact input at source for internal-doc content tools — same defense-in-depth as tool_result.
            // Other tools' inputs (begin/finalize/read_document, web_search, etc.) carry no content; pass through.
            const sensitive = DOC_TOOLS_WITH_CONTENT_INPUT.includes(event.tool);
            const input = sensitive && opts?.isCurrentDraftInternal?.() ? 'REDACTED' : event.input;
            enqueue({ type: 'tool_call_complete', tool: event.tool, id: event.id, input });
            return true;
        }

        case 'tool_result': {
            const result =
                event.tool === 'read_document' && event.metadata?.internal !== false ? 'REDACTED' : event.result;
            enqueue({
                type: 'tool_result',
                tool: event.tool,
                id: event.id,
                success: event.success,
                result,
                offsetMs: event.offsetMs,
                durationMs: event.durationMs,
            });
            return true;
        }

        case 'done':
            // Caller needs to capture this for pendingDoneEvent — but we can still handle the common case
            return false;

        case 'status_update':
            enqueue({ type: 'status_update', source: event.source, status: event.status });
            return true;

        case 'error':
            enqueue({ type: 'error', error: stringifyError(event.error), soft: event.soft ?? false });
            return true;

        case 'search_start':
            state.wasTool = true;
            enqueue({ type: 'search_start', query: event.query, blockId: event.blockId });
            return true;

        case 'search_results':
            enqueue({ type: 'search_results', blockId: event.blockId, resultCount: event.resultCount });
            return true;

        case 'citation':
            state.wasTool = true;
            enqueue({
                type: 'citation',
                url: event.url,
                citedText: event.citedText,
                title: event.title,
                blockId: event.blockId,
                parentTextBlockId: event.parentTextBlockId,
                startIndex: event.startIndex,
                endIndex: event.endIndex,
            });
            return true;

        case 'reasoning_start':
            enqueue({ type: 'reasoning_start', blockId: event.blockId, offsetMs: event.offsetMs });
            return true;

        case 'reasoning_delta':
            enqueue({ type: 'reasoning_delta', text: event.content, blockId: event.blockId });
            return true;

        case 'reasoning_done':
            enqueue({
                type: 'reasoning_done',
                blockId: event.blockId,
                offsetMs: event.offsetMs,
                durationMs: event.durationMs,
            });
            return true;

        case 'retry_attempt':
            enqueue({
                type: 'retry_attempt',
                attempt: event.attempt,
                maxAttempts: event.maxAttempts,
                reason: event.reason,
                provider: event.provider,
            });
            return true;

        default:
            return false; // Unknown events — let caller decide
    }
}

// ============================================================================
// FIRE-AND-FORGET PUSHER
// ============================================================================

export interface Pusher {
    /** Fire-and-forget push to ChatStreamDO with auto-incrementing seq. */
    push: (events: StreamEvent[]) => void;
    /** Await all in-flight pushes (call before terminal events). */
    waitAll: () => Promise<void>;
    /** Current sequence number (for the final awaited push of the terminal event). */
    get seq(): number;
}

const STREAM_PUSH_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function pushStreamEventsWithRetry({
    streamDO,
    events,
    seq,
    label,
}: {
    streamDO: ChatStreamDOStub;
    events: StreamEvent[];
    seq: number;
    label: string;
}): Promise<boolean> {
    let lastError: unknown;
    const maxAttempts = STREAM_PUSH_RETRY_DELAYS_MS.length + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await streamDO.push(events, seq);
            return true;
        } catch (error) {
            lastError = error;
            if (attempt < maxAttempts) {
                await wait(STREAM_PUSH_RETRY_DELAYS_MS[attempt - 1] ?? 1_500);
            }
        }
    }

    console.error(`[${label}] stream push failed after ${maxAttempts} attempts:`, lastError);
    return false;
}

export async function runBestEffortStreamCall({
    label,
    operation,
    action,
}: {
    label: string;
    operation: string;
    action: () => Promise<unknown>;
}): Promise<void> {
    try {
        await action();
    } catch (error) {
        console.error(`[${label}] stream ${operation} failed:`, error);
    }
}

/**
 * Factory for the fire-and-forget push pattern used by all handlers.
 * Encapsulates pushSeq counter + inflightPushes tracking.
 */
export function createPusher(streamDO: ChatStreamDOStub, label: string): Pusher {
    let pushSeq = 0;
    let pendingEvents: StreamEvent[] = [];
    let drainPromise: Promise<void> | null = null;

    const drain = async () => {
        while (pendingEvents.length > 0) {
            const events = pendingEvents;
            pendingEvents = [];
            await streamDO.push(events, pushSeq++).catch((err) => console.error(`[${label}] push failed:`, err));
        }
    };

    const ensureDrain = () => {
        drainPromise ??= drain().finally(() => {
            drainPromise = null;
        });
        return drainPromise;
    };

    return {
        push: (events: StreamEvent[]) => {
            if (events.length === 0) return;
            pendingEvents.push(...events);
            void ensureDrain();
        },
        waitAll: async () => {
            while (drainPromise || pendingEvents.length > 0) {
                await ensureDrain();
            }
        },
        get seq() {
            return pushSeq++;
        },
    };
}

// ============================================================================
// ERROR CLEANUP HELPERS
// ============================================================================

/**
 * Persist an error agent message row if one doesn't already exist.
 * Used by chat-handler and intake-handler catch blocks.
 * Phase transition skips this (no agent message to persist on error).
 */
export async function persistErrorMessage({
    em,
    chatId,
    agentMessageId,
    chat,
    error,
    errorMetadata,
    label,
}: {
    em: any;
    chatId: string;
    agentMessageId: string;
    chat: { active_agent_message_id?: string | null };
    error: any;
    errorMetadata: StoredErrorMetadata;
    label: string;
}) {
    try {
        const existing = await em.findOne(ChatMessageEntity, { id: agentMessageId });
        if (!existing) {
            const errorMsg = em.create(ChatMessageEntity, {
                id: agentMessageId,
                chat: chatId,
                role: 'assistant',
                content: '',
                is_error: true,
                metadata: { error: errorMetadata },
                debug_data: { error: serializeException(error) },
            });
            em.persist(errorMsg);
        } else {
            const existingMetadata = ((existing.metadata as Record<string, unknown> | null) ?? {}) as Record<
                string,
                unknown
            >;
            const existingDebugData = ((existing.debug_data as Record<string, unknown> | null) ?? {}) as Record<
                string,
                unknown
            >;
            const hasErrorMetadata =
                typeof (existingMetadata.error as Record<string, unknown> | undefined)?.code === 'string';
            const hasPersistedPayload =
                !!existing.content?.trim() ||
                !!existing.reasoning?.trim() ||
                (Array.isArray(existing.blocks) && existing.blocks.length > 0);

            // A stream-recovery placeholder may already exist with empty content,
            // empty blocks, and no metadata. Do not leave that row opaque when the
            // worker has the real classified error available.
            if (!hasErrorMetadata && (existing.is_error || !hasPersistedPayload)) {
                existing.is_error = true;
                existing.metadata = { ...existingMetadata, error: errorMetadata };
                existing.debug_data = { ...existingDebugData, error: serializeException(error) };
            }
        }
        chat.active_agent_message_id = null;
        await em.flush();
    } catch (saveErr) {
        logWorkerError(
            label,
            buildWorkerErrorLogContext({
                classification: classifyWorkerError(saveErr),
                stage: 'persist_error_state',
                chatId,
                agentMessageId,
                error: saveErr,
            }),
            saveErr,
        );
    }
}

/**
 * Error epilogue: drain inflight pushes, push error event, done+finalize, clearStream.
 * Shared by all three handlers' catch blocks.
 */
export async function cleanupStreamDO({
    pusher,
    streamDO,
    ugStub,
    topic,
    error,
    errorMetadata,
}: {
    pusher: Pusher;
    streamDO: ChatStreamDOStub;
    ugStub: UserGatewayStub;
    topic: string;
    error: any;
    errorMetadata?: StoredErrorMetadata;
}) {
    try {
        await pusher.waitAll();
        const safeMetadata = errorMetadata ?? buildStoredErrorMetadata({ classification: classifyWorkerError(error) });
        const errorSignal = safeMetadata.code;
        const terminalDelivered = await pushStreamEventsWithRetry({
            streamDO,
            events: [
                { type: 'error', error: errorSignal },
                {
                    type: 'done',
                    error: errorSignal,
                    messageMetadata: { error: safeMetadata },
                },
            ],
            seq: pusher.seq,
            label: 'stream-cleanup',
        });
        if (terminalDelivered) {
            await runBestEffortStreamCall({
                label: 'stream-cleanup',
                operation: 'done',
                action: () => streamDO.done(),
            });
        } else {
            console.error('[stream-cleanup] terminal error delivery failed; skipping stream_status:done');
        }
        await runBestEffortStreamCall({
            label: 'stream-cleanup',
            operation: 'finalize',
            action: () => streamDO.finalize(),
        });
    } catch {
        /* DO might already be gone */
    } finally {
        await ugStub.systemAction(topic, 'clearStream', {}).catch(() => {});
    }
}

// ============================================================================
// DO PUSH HELPER
// ============================================================================

/**
 * Convert handleCommonStreamEvent's enqueue-based API into StreamEvent[] collection.
 * Creates a collector that captures what handleCommonStreamEvent would enqueue,
 * returning the events for DO push instead.
 */
export function createEventCollector(): { enqueue: (data: object | string) => boolean; drain: () => StreamEvent[] } {
    const events: StreamEvent[] = [];
    return {
        enqueue: (data: object | string) => {
            if (typeof data === 'string') return false; // Skip '[DONE]' sentinel
            events.push(data as StreamEvent);
            return true;
        },
        drain: () => {
            const copy = [...events];
            events.length = 0;
            return copy;
        },
    };
}

// ============================================================================
// HISTORY LOADING
// ============================================================================

/**
 * Load chat messages from DB and map to inference-ready format.
 * For user messages with attached images, generates signed URLs and
 * builds multimodal ContentPart[] content.
 */
export async function loadChatHistory(em: any, chatId: string, env?: ChatEnv) {
    // Load messages and image files in parallel
    const [dbMessages, imageFiles] = await Promise.all([
        em
            .createQueryBuilder(ChatMessageEntity, 'm')
            .select('m.*')
            .where({ chat: chatId })
            .orderBy({ 'm.created_at': 'ASC' })
            .getResult(),
        env
            ? em.find(ChatMessageFileEntity, {
                  chat_id: chatId,
                  chat_message: { $ne: null },
                  status: 'uploaded',
              })
            : Promise.resolve([]),
    ]);

    // Group image files by message ID
    const filesByMessage = new Map<string, ChatMessageFileEntity[]>();
    for (const file of imageFiles as ChatMessageFileEntity[]) {
        const msgId = typeof file.chat_message === 'object' ? (file.chat_message as any)?.id : file.chat_message;
        if (!msgId) continue;
        const existing = filesByMessage.get(msgId);
        if (existing) existing.push(file);
        else filesByMessage.set(msgId, [file]);
    }

    // Generate signed URLs for all image files (single batch)
    const signedUrls =
        env && imageFiles.length > 0
            ? await generateSignedImageUrls(env, imageFiles as ChatMessageFileEntity[])
            : new Map<string, string>();

    // Reconstruct toolContentParts for tool blocks with toolImageRefs.
    // toolContentParts is ephemeral (stripped before DB save), so we rebuild
    // it from the stable toolImageRefs + freshly signed URLs.
    if (env) {
        // Collect all unique R2 keys across all tool blocks in history
        const artifactImageKeys = new Set<string>();
        const SCHEME = 'artifact-image://';
        for (const m of dbMessages as ChatMessageEntity[]) {
            if (!m.blocks) continue;
            for (const b of m.blocks as any[]) {
                if (b.type === 'tool_call' && b.toolImageRefs?.length) {
                    for (const ref of b.toolImageRefs as string[]) {
                        if (ref.startsWith(SCHEME)) {
                            artifactImageKeys.add(ref.slice(SCHEME.length));
                        }
                    }
                }
            }
        }

        if (artifactImageKeys.size > 0) {
            const artifactSignedUrls = await signArtifactImageKeys(env, [...artifactImageKeys]);

            for (const m of dbMessages as ChatMessageEntity[]) {
                if (!m.blocks) continue;
                for (const b of m.blocks as any[]) {
                    if (b.type !== 'tool_call' || !b.toolImageRefs?.length) continue;

                    b.toolContentParts = buildArtifactImageContentParts(b.toolOutput ?? '', artifactSignedUrls);
                }
            }
        }
    }

    return dbMessages.map((m: ChatMessageEntity) => {
        if (m.is_error || m.is_aborted) {
            let safeContent = m.content || '';
            if (m.reasoning) {
                safeContent = `<thinking>${m.reasoning}</thinking>\n\n${safeContent}`;
            }
            const marker = m.is_error
                ? '[This response was interrupted by an error]'
                : '[This response was aborted by user]';
            if (safeContent) {
                safeContent += `\n\n${marker}`;
            }
            return { role: m.role as 'user' | 'assistant', content: safeContent };
        }

        // Check for attached images on user messages
        const msgFiles = filesByMessage.get(m.id);
        if (m.role === 'user' && msgFiles?.length) {
            const parts: ContentPart[] = [];
            // Text content first
            if (m.content) {
                parts.push({ type: 'text', text: m.content });
            }
            // Image parts with signed URLs
            for (const file of msgFiles) {
                const url = signedUrls.get(file.id);
                if (url) {
                    parts.push({
                        type: 'image',
                        source: 'url',
                        url,
                        mediaType: file.mime_type as ImageContentPart['mediaType'],
                    });
                }
            }
            return {
                role: 'user' as const,
                content: parts.length > 0 ? parts : m.content,
            };
        }

        return {
            role: m.role as 'user' | 'assistant',
            content: m.content,
            ...(m.blocks && { blocks: m.blocks }),
        };
    });
}

// ============================================================================
// ERROR PERSISTENCE
// ============================================================================

/**
 * Persist error messages to DB and send error SSE event. Closes the controller.
 *
 * @param requestStartedAt - Timestamp of the original request. Used to set
 *   `created_at` on the user message and ensure the error message gets a
 *   later timestamp (avoids ordering collisions).
 */
export async function handleStreamError(
    error: any,
    em: any,
    chatId: string,
    message: string,
    enqueue: Enqueue,
    controller: ReadableStreamDefaultController<Uint8Array>,
    requestStartedAt: Date = new Date(),
) {
    const serialized = serializeException(error);
    console.log('ERROR ', JSON.stringify(serialized, undefined, 2));

    const errorMetadata = buildStoredErrorMetadata({ classification: classifyWorkerError(error) });

    try {
        const userMsg = em.create(ChatMessageEntity, {
            chat: chatId,
            role: 'user',
            content: message,
            created_at: requestStartedAt,
        });
        em.persist(userMsg);

        const errorMsg = em.create(ChatMessageEntity, {
            chat: chatId,
            role: 'assistant',
            content: '',
            is_error: true,
            created_at: new Date(Math.max(Date.now(), requestStartedAt.getTime() + 100)),
            metadata: { error: errorMetadata },
            debug_data: { error: serialized },
        });
        em.persist(errorMsg);

        await em.flush();
    } catch (saveErr) {
        console.log('Failed to save error messages:', saveErr);
    }

    enqueue({ type: 'error', error: errorMetadata.code });
    try {
        controller.close();
    } catch {
        /* client already gone */
    }
}

// ============================================================================
// SSE STREAM WRAPPER
// ============================================================================

/**
 * Wrap an async handler into a ReadableStream for SSE responses.
 *
 * The handler runs **independently** of the stream's lifecycle. If the client
 * disconnects (ReadableStream gets cancelled), the handler keeps running to
 * completion — so done_ext emission and DB persistence always happen.
 */
export function createSSEStream(
    handler: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>,
    ctx?: Ctx,
): ReadableStream<Uint8Array> {
    // Internal buffer decouples handler from stream consumer.
    const buffer: Uint8Array[] = [];
    let handlerDone = false;
    let handlerError: unknown = null;
    let wakeup: (() => void) | null = null;

    const signal = () => {
        wakeup?.();
        wakeup = null;
    };

    // Proxy controller — buffers enqueue/close so the handler never touches
    // the real stream controller (which dies on client disconnect).
    const proxy = {
        enqueue(chunk: Uint8Array) {
            buffer.push(chunk);
            signal();
        },
        close() {
            handlerDone = true;
            signal();
        },
        error(e?: any) {
            handlerError = e;
            handlerDone = true;
            signal();
        },
        get desiredSize() {
            return Math.max(0, 16 - buffer.length);
        },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    // Handler starts synchronously here — guaranteed to have begun before
    // the ReadableStream is even constructed (matches old start() eagerness).
    const handlerPromise = handler(proxy).catch((err) => {
        handlerError = err;
        handlerDone = true;
        signal();
    });
    ctx?.eCtx?.waitUntil(handlerPromise);

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            // Wait for buffered data or handler completion
            while (buffer.length === 0 && !handlerDone) {
                await new Promise<void>((r) => {
                    wakeup = r;
                });
            }
            // Forward buffered chunks to the real controller
            while (buffer.length > 0) {
                try {
                    controller.enqueue(buffer.shift()!);
                } catch {
                    return;
                }
            }
            if (handlerDone && buffer.length === 0) {
                // Propagate handler errors to the stream (matches old start() rejection behavior)
                if (handlerError) {
                    try {
                        controller.error(handlerError);
                    } catch {
                        /* already closed */
                    }
                } else {
                    try {
                        controller.close();
                    } catch {
                        /* already closed/cancelled */
                    }
                }
            }
        },
        cancel() {
            // Client disconnected — handler keeps running independently.
            // Buffered data will be GC'd when the handler finishes.
        },
    });
}
