/**
 * Stream testing utilities.
 *
 * Two consumption modes:
 *
 * 1. SSE (intake / summarize routes that still return SSE streams):
 *    const res = await fetch(`${BASE}/api/intake`, { method: "POST", body });
 *    const events = await collectStreamEvents(res);
 *
 * 2. Direct onEvent (chatActionHandler with onEvent callback):
 *    const { onEvent, events, generation } = createEventCollector();
 *    const result = await chatActionHandler(input, ctx, { onEvent });
 *    await result.generation;
 *    expect(events.some(e => e.type === "done")).toBe(true);
 */

import type { StreamEvent, StreamEventType } from '@/modules/chat/types';

// ---------------------------------------------------------------------------
// SSE parsing (inlined — was in modules/chat/services/stream-parser.ts)
// ---------------------------------------------------------------------------

type SSEMessage = { event?: string; data: string; id?: string; retry?: number };
type ParsedSSEChunk = { messages: SSEMessage[]; remainder: string };

function parseSSEChunk(buffer: string): ParsedSSEChunk {
    const messages: SSEMessage[] = [];
    const lines = buffer.split('\n');
    let currentMessage: Partial<SSEMessage> = {};
    let remainder = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === lines.length - 1 && line !== '') {
            remainder = line;
            break;
        }
        if (line === '') {
            if (currentMessage.data !== undefined) messages.push(currentMessage as SSEMessage);
            currentMessage = {};
            continue;
        }
        if (line.startsWith(':')) continue;
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        const field = line.slice(0, colonIndex);
        let value = line.slice(colonIndex + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        switch (field) {
            case 'event':
                currentMessage.event = value;
                break;
            case 'data':
                currentMessage.data = currentMessage.data ? `${currentMessage.data}\n${value}` : value;
                break;
            case 'id':
                currentMessage.id = value;
                break;
            case 'retry':
                currentMessage.retry = Number.parseInt(value, 10);
                break;
        }
    }
    return { messages, remainder };
}

function parseStreamEventData(data: string): StreamEvent | null {
    if (data === '[DONE]') return { type: 'done' };
    try {
        return JSON.parse(data) as StreamEvent;
    } catch {
        if (data.trim()) return { type: 'delta', text: data };
        return null;
    }
}

// Re-export types for convenience in test files
export type { StreamEvent, StreamEventType };

// ---------------------------------------------------------------------------
// Core: consume a Response and collect all StreamEvents
// ---------------------------------------------------------------------------

/**
 * Read an SSE response body to completion and return every parsed StreamEvent.
 *
 * Works with both Web `Response` (fetch) and Node `ReadableStream` bodies.
 * Throws if the response has no body.
 */
export async function collectStreamEvents(response: Response): Promise<StreamEvent[]> {
    const body = response.body;
    if (!body) {
        throw new Error('Response has no body — is the endpoint returning a stream?');
    }

    const events: StreamEvent[] = [];
    let buffer = '';
    const decoder = new TextDecoder();

    const reader = body.getReader();

    // biome-ignore lint/correctness/noConstantCondition: intentional infinite loop
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { messages, remainder } = parseSSEChunk(buffer);
        buffer = remainder;

        for (const msg of messages) {
            const event = parseStreamEventData(msg.data);
            if (event) events.push(event);
        }
    }

    // Flush any trailing data
    if (buffer.trim()) {
        const event = parseStreamEventData(buffer);
        if (event) events.push(event);
    }

    return events;
}

/**
 * Same as collectStreamEvents but also yields events one-by-one via callback
 * so tests can assert on ordering / timing without collecting everything first.
 */
export async function consumeStream(response: Response, onEvent: (event: StreamEvent) => void): Promise<StreamEvent[]> {
    const body = response.body;
    if (!body) {
        throw new Error('Response has no body');
    }

    const events: StreamEvent[] = [];
    let buffer = '';
    const decoder = new TextDecoder();
    const reader = body.getReader();

    // biome-ignore lint/correctness/noConstantCondition: intentional infinite loop
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { messages, remainder } = parseSSEChunk(buffer);
        buffer = remainder;

        for (const msg of messages) {
            const event = parseStreamEventData(msg.data);
            if (event) {
                events.push(event);
                onEvent(event);
            }
        }
    }

    if (buffer.trim()) {
        const event = parseStreamEventData(buffer);
        if (event) {
            events.push(event);
            onEvent(event);
        }
    }

    return events;
}

// ---------------------------------------------------------------------------
// Mock: build a fake SSE Response for component / unit tests
// ---------------------------------------------------------------------------

/** Encode StreamEvents into an SSE wire-format string. */
function encodeSSE(events: StreamEvent[]): string {
    let out = '';
    for (const event of events) {
        if (event.type === 'done' && !('tokenUsage' in event && event.tokenUsage)) {
            // Bare done → [DONE] marker
            out += 'data: [DONE]\n\n';
        } else {
            out += `data: ${JSON.stringify(event)}\n\n`;
        }
    }
    return out;
}

/**
 * Build a Response whose body is a ReadableStream of SSE-encoded events.
 *
 * Feed this into any code that consumes a fetch Response (hooks, services).
 * Events are emitted in a single chunk — for chunked delivery pass `chunked: true`.
 *
 * ```ts
 * const res = mockSSEResponse([
 *   { type: "delta", text: "Hello" },
 *   { type: "done" },
 * ]);
 * const events = await collectStreamEvents(res);
 * ```
 */
export function mockSSEResponse(events: StreamEvent[], opts?: { chunked?: boolean }): Response {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            if (opts?.chunked) {
                for (const event of events) {
                    controller.enqueue(encoder.encode(encodeSSE([event])));
                }
            } else {
                controller.enqueue(encoder.encode(encodeSSE(events)));
            }
            controller.close();
        },
    });

    return new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
    });
}

// ---------------------------------------------------------------------------
// Direct event collection (onEvent callback — no SSE parsing)
// ---------------------------------------------------------------------------

/**
 * Create an event collector for chatActionHandler's onEvent callback.
 *
 * Usage:
 *   const collector = createEventCollector();
 *   const result = await chatActionHandler(input, ctx, { onEvent: collector.onEvent });
 *   await result.generation;
 *   expect(collector.events.some(e => e.type === "done")).toBe(true);
 */
export function createEventCollector() {
    const events: StreamEvent[] = [];
    const onEvent = (event: StreamEvent) => {
        events.push(event);
    };
    return { onEvent, events };
}

// ---------------------------------------------------------------------------
// Filtering helpers
// ---------------------------------------------------------------------------

/** Narrow events to a specific type. */
export function eventsOfType<T extends StreamEventType>(
    events: StreamEvent[],
    type: T,
): Extract<StreamEvent, { type: T }>[] {
    return events.filter((e): e is Extract<StreamEvent, { type: T }> => e.type === type);
}

/** Get all text deltas concatenated into a single string. */
export function collectText(events: StreamEvent[]): string {
    return eventsOfType(events, 'delta')
        .map((e) => e.text)
        .join('');
}

/** Get all document content concatenated per document name. */
export function collectDocuments(events: StreamEvent[]): Record<string, string> {
    const docs: Record<string, string> = {};
    for (const e of events) {
        if (e.type === 'document_delta') {
            docs[e.name] = (docs[e.name] ?? '') + e.content;
        }
    }
    return docs;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Assert no events of given type(s) exist — useful for redaction checks. */
export function expectNoEvents(events: StreamEvent[], ...types: StreamEventType[]) {
    for (const type of types) {
        const found = eventsOfType(events, type);
        if (found.length > 0) {
            throw new Error(`Expected no "${type}" events but found ${found.length}: ${JSON.stringify(found[0])}`);
        }
    }
}

/** Assert the stream ended cleanly with a "done" event. */
export function expectStreamDone(events: StreamEvent[]) {
    const last = events[events.length - 1];
    if (!last || last.type !== 'done') {
        throw new Error(`Expected stream to end with "done" event, got: ${last ? last.type : 'no events'}`);
    }
}

/** Assert the stream contains at least one error event. */
export function expectStreamError(events: StreamEvent[], messagePattern?: RegExp) {
    const errors = eventsOfType(events, 'error');
    if (errors.length === 0) {
        throw new Error('Expected at least one error event in stream');
    }
    if (messagePattern) {
        const match = errors.some((e) => messagePattern.test(e.error));
        if (!match) {
            throw new Error(
                `No error event matched pattern ${messagePattern}. Errors: ${errors.map((e) => e.error).join(', ')}`,
            );
        }
    }
}
