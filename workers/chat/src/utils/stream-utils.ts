/**
 * Shared streaming utilities for agent chat handlers.
 *
 * Small helpers reused by chat-handler and intake-handler.
 * NOT a mega-abstraction — each handler keeps its own stream loop
 * and done_ext handling.
 */

import type { AgentStreamEvent } from '@common/ai/agent';
import { serializeException } from '@/common/ai/utils';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { Ctx } from '../context';

type Enqueue = (data: object | string) => void;

// ============================================================================
// SSE HELPERS
// ============================================================================

export function createEnqueue(controller: ReadableStreamDefaultController<Uint8Array>): Enqueue {
    const encoder = new TextEncoder();
    return (data: object | string) => {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
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
            enqueue({ type: 'error', error: String(event.error), soft: event.soft ?? false });
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
            enqueue({ type: 'reasoning_done', blockId: event.blockId, offsetMs: event.offsetMs, durationMs: event.durationMs });
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
            return true; // Ignore unknown events
    }
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
        if (m.is_error) {
            let safeContent = m.content || '';
            if (m.reasoning) {
                safeContent = `<thinking>${m.reasoning}</thinking>\n\n${safeContent}`;
            }
            if (safeContent) {
                safeContent += '\n\n[This response was interrupted by an error]';
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
 */
export async function handleStreamError(
    error: any,
    em: any,
    chatId: string,
    message: string,
    enqueue: Enqueue,
    controller: ReadableStreamDefaultController<Uint8Array>,
) {
    const serialized = serializeException(error);
    console.log('ERROR ', JSON.stringify(serialized, undefined, 2));

    try {
        const userMsg = em.create(ChatMessageEntity, { chat: chatId, role: 'user', content: message });
        em.persist(userMsg);

        const errorMsg = em.create(ChatMessageEntity, {
            chat: chatId,
            role: 'assistant',
            content: '',
            is_error: true,
            metadata: { error: serialized.message || JSON.stringify(serialized) },
            debug_data: { error: serialized },
        });
        em.persist(errorMsg);

        await em.flush();
    } catch (saveErr) {
        console.log('Failed to save error messages:', saveErr);
    }

    enqueue({ type: 'error', error: serialized.message || JSON.stringify(serialized) });
    controller.close();
}

// ============================================================================
// SSE STREAM WRAPPER
// ============================================================================

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap an async handler into a ReadableStream for SSE responses.
 */
export async function createSSEStream(
    handler: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>,
    ctx?: Ctx,
) {
    let ready = false;
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const promise = handler(controller);
            ctx?.eCtx?.waitUntil(promise);
            ready = true;
            await promise;
        },
    });
    while (!ready) await sleep(10);
    return stream;
}
