import type { ArtifactMetadata, ParsedSSEChunk, SSEMessage, StreamEvent } from '../types';

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
            case 'text':
                return { type: 'text', content: parsed.content ?? '' };

            case 'artifact_start':
                return {
                    type: 'artifact_start',
                    artifactId: parsed.artifactId ?? parsed.id ?? crypto.randomUUID(),
                    metadata: {
                        identifier: parsed.identifier ?? parsed.artifactId ?? 'artifact',
                        title: parsed.title ?? 'Untitled',
                        type: parsed.artifactType ?? 'text/markdown',
                        language: parsed.language,
                    } satisfies ArtifactMetadata,
                };

            case 'artifact_chunk':
                return {
                    type: 'artifact_chunk',
                    artifactId: parsed.artifactId ?? parsed.id ?? '',
                    content: parsed.content ?? '',
                };

            case 'artifact_end':
                return {
                    type: 'artifact_end',
                    artifactId: parsed.artifactId ?? parsed.id ?? '',
                };

            case 'error':
                return { type: 'error', error: parsed.error ?? 'Unknown error' };

            case 'done':
                return { type: 'done' };

            default:
                // Try to handle unknown format - assume it's text content
                if (typeof parsed.content === 'string') {
                    return { type: 'text', content: parsed.content };
                }
                return null;
        }
    } catch {
        // If not JSON, treat raw data as text content
        if (data.trim()) {
            return { type: 'text', content: data };
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
