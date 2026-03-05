/**
 * Shared streaming utilities for agent chat handlers.
 *
 * Small helpers reused by chat-handler, intake-handler, and summarizer.
 * NOT a mega-abstraction — each handler keeps its own stream loop
 * and done_ext handling.
 */

import type { AgentStreamEvent } from '@common/ai/agent';
import { serializeException, stringifyError } from '@/common/ai/utils';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { StreamEvent } from '@/lib/schema/stream';
import type { Ctx } from '../context';
import type { ChatStreamDOStub, UserGatewayStub } from './do-stubs';

// ============================================================================
// DO LIFECYCLE HELPERS
// ============================================================================

/**
 * Wire a ChatStreamDO to an AbortController via long-polling.
 * Starts an async loop that calls abortWait() and triggers the controller.
 */
export function wireAbort(streamDO: ChatStreamDOStub): AbortController {
    const abortController = new AbortController();
    (async () => {
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
export function handleCommonStreamEvent(
    enqueue: Enqueue,
    event: AgentStreamEvent,
    state: { wasTool: boolean },
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

        case 'tool_result':
            enqueue({
                type: 'tool_result',
                tool: event.tool,
                id: event.id,
                success: event.success,
                result: event.result,
                offsetMs: event.offsetMs,
                durationMs: event.durationMs,
            });
            return true;

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
 */
export async function loadChatHistory(em: any, chatId: string) {
    const dbMessages = await em.find(ChatMessageEntity, { chat: chatId }, { orderBy: { created_at: 'ASC' } });
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
            metadata: { error: serialized.message || JSON.stringify(serialized) },
            debug_data: { error: serialized },
        });
        em.persist(errorMsg);

        await em.flush();
    } catch (saveErr) {
        console.log('Failed to save error messages:', saveErr);
    }

    enqueue({ type: 'error', error: serialized.message || JSON.stringify(serialized) });
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
