import type { ParsedSSEChunk, SSEMessage, StreamEvent } from '../types';

export function parseSSEChunk(buffer: string): ParsedSSEChunk {
    const messages: SSEMessage[] = [];
    const lines = buffer.split('\n');
    let currentMessage: Partial<SSEMessage> = {};
    let remainder = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check if this might be an incomplete line (last line without a pair)
        if (i === lines.length - 1 && line !== '') {
            remainder = line;
            break;
        }

        if (line === '') {
            // Empty line = end of message
            if (currentMessage.data !== undefined) {
                messages.push(currentMessage as SSEMessage);
            }
            currentMessage = {};
            continue;
        }

        if (line.startsWith(':')) {
            // Comment line, ignore
            continue;
        }

        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
            // Field with no value
            continue;
        }

        const field = line.slice(0, colonIndex);
        // Skip the colon and optional space
        let value = line.slice(colonIndex + 1);
        if (value.startsWith(' ')) {
            value = value.slice(1);
        }

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
            default:
                break;
        }
    }

    return { messages, remainder };
}

/**
 * Parse a single SSE data payload into a StreamEvent.
 * Expects JSON format from the server.
 */
export function parseStreamEventData(data: string): StreamEvent | null {
    // Handle special [DONE] marker
    if (data === '[DONE]') {
        return { type: 'done' };
    }

    try {
        const parsed = JSON.parse(data);

        switch (parsed.type) {
            // Text content
            case 'delta':
                return { type: 'delta', text: parsed.text ?? '', blockId: parsed.blockId };

            case 'created':
                return { type: 'created', id: parsed.id ?? '' };

            // Reasoning/thinking
            case 'reasoning_start':
                return { type: 'reasoning_start', blockId: parsed.blockId };

            case 'reasoning_delta':
                return { type: 'reasoning_delta', text: parsed.text, content: parsed.content };

            case 'reasoning_done':
                return { type: 'reasoning_done', durationMs: parsed.durationMs };

            // Tool calls
            case 'tool_start':
                return { type: 'tool_start', id: parsed.id ?? '', tool: parsed.tool ?? '' };

            case 'tool_result':
                return {
                    type: 'tool_result',
                    id: parsed.id ?? '',
                    result: parsed.result,
                    success: parsed.success ?? true,
                };

            // Documents/artifacts
            case 'document_start':
                return {
                    type: 'document_start',
                    name: parsed.name ?? '',
                    title: parsed.title,
                    pendingVersion: parsed.pendingVersion ?? 1,
                };

            case 'document_delta':
                return {
                    type: 'document_delta',
                    name: parsed.name ?? '',
                    pendingVersion: parsed.pendingVersion ?? 1,
                    content: parsed.content ?? '',
                };

            case 'document_edit':
                return {
                    type: 'document_edit',
                    name: parsed.name ?? '',
                    pendingVersion: parsed.pendingVersion ?? 1,
                    edits: parsed.edits ?? [],
                };

            case 'document_complete':
                return {
                    type: 'document_complete',
                    name: parsed.name ?? '',
                    version: parsed.version ?? 1,
                };

            // Status & control
            case 'status_update':
                return { type: 'status_update', status: parsed.status ?? '' };

            case 'error':
                return { type: 'error', error: parsed.error ?? 'Unknown error' };

            case 'done':
                return { type: 'done' };

            case 'done_ext':
                return { type: 'done_ext' };

            default:
                // Log unknown event types for debugging
                console.log('Unknown stream event type:', parsed.type, parsed);
                return null;
        }
    } catch {
        // If not JSON, treat raw data as text delta
        if (data.trim()) {
            return { type: 'delta', text: data };
        }
        return null;
    }
}

/**
 * Create a stream reader that processes SSE data and emits events.
 */
export function createStreamProcessor(onEvent: (event: StreamEvent) => void) {
    let buffer = '';

    return {
        processChunk(chunk: string): void {
            buffer += chunk;
            const { messages, remainder } = parseSSEChunk(buffer);
            buffer = remainder;

            for (const message of messages) {
                const event = parseStreamEventData(message.data);
                if (event) {
                    onEvent(event);
                }
            }
        },

        flush(): void {
            if (buffer.trim()) {
                const event = parseStreamEventData(buffer);
                if (event) {
                    onEvent(event);
                }
            }
            buffer = '';
        },

        reset(): void {
            buffer = '';
        },
    };
}
