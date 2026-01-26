'use client';

import { useCallback, useRef } from 'react';
import type { ArtifactContextValue } from '@/modules/chat/providers/artifact-provider';
import type { Message, StreamBlock } from '../types';

/** Streaming state for building assistant messages */
type StreamingState = {
    blocks: StreamBlock[];
    currentTextBlockId: string | null;
    currentReasoningBlockId: string | null;
    streamingDocs: Map<string, { artifactId: string; content: string }>;
};

type UseStreamReaderOptions = {
    /** Artifact context for document streaming */
    artifactContext: Pick<
        ArtifactContextValue,
        'addArtifact' | 'updateArtifact' | 'setCurrentArtifact' | 'setStreamingComplete'
    >;
    /** Callback to update messages state */
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    /** Callback to set loading state */
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
    /** Called when an artifact stream completes */
    onArtifactComplete?: () => void;
};

/**
 * Hook that provides a `readStream` function for processing SSE streams
 * and building StreamBlock-based messages.
 */
export function useStreamReader({
    artifactContext,
    setMessages,
    setIsLoading,
    onArtifactComplete,
}: UseStreamReaderOptions) {
    const { addArtifact, updateArtifact, setCurrentArtifact, setStreamingComplete } = artifactContext;

    // Streaming state ref to avoid stale closures
    const streamingStateRef = useRef<StreamingState | null>(null);

    const readStream = useCallback(
        async (stream: ReadableStream<Uint8Array>) => {
            const reader = stream.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            const streamingMsgId = `streaming-${Date.now()}`;

            // Initialize streaming state
            streamingStateRef.current = {
                blocks: [],
                currentTextBlockId: null,
                currentReasoningBlockId: null,
                streamingDocs: new Map(),
            };

            const streaming = streamingStateRef.current;

            // Add empty assistant message to start streaming into
            setMessages((prev) => [...prev, { id: streamingMsgId, role: 'assistant', blocks: [], isStreaming: true }]);

            // Helper to update streaming message
            const updateStreamingMessage = () => {
                setMessages((prev) =>
                    prev.map((msg) => (msg.id === streamingMsgId ? { ...msg, blocks: [...streaming.blocks] } : msg)),
                );
            };

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const jsonString = line.replace('data: ', '').trim();
                        if (jsonString === '[DONE]') continue;

                        try {
                            const event = JSON.parse(jsonString);

                            if (event.error) {
                                console.error('Stream error:', event.error);
                                break;
                            }

                            switch (event.type) {
                                case 'reasoning_start': {
                                    const reasoningBlockId = event.blockId || `reasoning-${Date.now()}`;
                                    streaming.currentReasoningBlockId = reasoningBlockId;
                                    streaming.blocks.push({
                                        id: reasoningBlockId,
                                        type: 'reasoning',
                                        content: '',
                                    });
                                    updateStreamingMessage();
                                    break;
                                }

                                case 'reasoning_delta':
                                    if (event.text || event.content) {
                                        const idx = streaming.blocks.findIndex(
                                            (b) => b.id === streaming.currentReasoningBlockId,
                                        );
                                        if (idx !== -1 && streaming.blocks[idx].type === 'reasoning') {
                                            streaming.blocks[idx] = {
                                                ...streaming.blocks[idx],
                                                content: streaming.blocks[idx].content + (event.text || event.content),
                                            } as StreamBlock;
                                            updateStreamingMessage();
                                        }
                                    }
                                    break;

                                case 'reasoning_done':
                                    if (streaming.currentReasoningBlockId && event.durationMs !== undefined) {
                                        const idx = streaming.blocks.findIndex(
                                            (b) => b.id === streaming.currentReasoningBlockId,
                                        );
                                        if (idx !== -1 && streaming.blocks[idx].type === 'reasoning') {
                                            streaming.blocks[idx] = {
                                                ...streaming.blocks[idx],
                                                durationMs: event.durationMs,
                                            } as StreamBlock;
                                            updateStreamingMessage();
                                        }
                                    }
                                    streaming.currentReasoningBlockId = null;
                                    break;

                                case 'tool_start':
                                    streaming.blocks.push({
                                        id: event.id || `tool-${Date.now()}`,
                                        type: 'tool_call',
                                        content: '',
                                        toolName: event.tool,
                                        toolInput: {},
                                        toolCallId: event.id,
                                    });
                                    updateStreamingMessage();
                                    break;

                                case 'tool_result': {
                                    const tIdx = streaming.blocks.findIndex(
                                        (b) => b.type === 'tool_call' && b.toolCallId === event.id,
                                    );
                                    if (tIdx !== -1 && streaming.blocks[tIdx].type === 'tool_call') {
                                        streaming.blocks[tIdx] = {
                                            ...streaming.blocks[tIdx],
                                            content:
                                                typeof event.result === 'string'
                                                    ? event.result
                                                    : JSON.stringify(event.result),
                                            toolOutput:
                                                typeof event.result === 'string'
                                                    ? event.result
                                                    : JSON.stringify(event.result),
                                            toolSuccess: event.success,
                                        } as StreamBlock;
                                        updateStreamingMessage();
                                    }
                                    break;
                                }

                                case 'delta': {
                                    if (event.text) {
                                        if (!streaming.currentTextBlockId) {
                                            const textBlockId = event.blockId || `text-${Date.now()}`;
                                            streaming.currentTextBlockId = textBlockId;
                                            streaming.blocks.push({
                                                id: textBlockId,
                                                type: 'text',
                                                content: '',
                                            });
                                        }
                                        const textIdx = streaming.blocks.findIndex(
                                            (b) => b.id === streaming.currentTextBlockId,
                                        );
                                        if (textIdx !== -1 && streaming.blocks[textIdx].type === 'text') {
                                            streaming.blocks[textIdx] = {
                                                ...streaming.blocks[textIdx],
                                                content: streaming.blocks[textIdx].content + event.text,
                                            } as StreamBlock;
                                            updateStreamingMessage();
                                        }
                                    }
                                    break;
                                }

                                case 'created':
                                    if (event.id) {
                                        setMessages((prev) =>
                                            prev.map((msg) =>
                                                msg.id === streamingMsgId ? { ...msg, id: event.id } : msg,
                                            ),
                                        );
                                    }
                                    break;

                                case 'document_start': {
                                    const docKey = `${event.name}_${event.pendingVersion}`;
                                    const artifactId = `doc-${event.name}-v${event.pendingVersion}`;
                                    console.log('[stream-reader] document_start:', {
                                        docKey,
                                        artifactId,
                                        name: event.name,
                                        title: event.title,
                                    });
                                    streaming.streamingDocs.set(docKey, { artifactId, content: '' });
                                    addArtifact(
                                        {
                                            id: artifactId,
                                            identifier: event.name,
                                            title: event.title || event.name,
                                            type: 'text/markdown',
                                            content: '',
                                            messageId: streamingMsgId,
                                        },
                                        true,
                                    );
                                    setCurrentArtifact(artifactId);
                                    break;
                                }

                                case 'document_delta': {
                                    const docKey = `${event.name}_${event.pendingVersion}`;
                                    const doc = streaming.streamingDocs.get(docKey);
                                    if (doc) {
                                        doc.content += event.content;
                                        updateArtifact(doc.artifactId, { content: doc.content });
                                    } else {
                                        console.warn('[stream-reader] document_delta: doc not found for key', docKey);
                                    }
                                    break;
                                }

                                case 'document_edit': {
                                    const docKey = `${event.name}_${event.pendingVersion}`;
                                    const doc = streaming.streamingDocs.get(docKey);
                                    if (doc && event.edits) {
                                        let content = doc.content;
                                        for (const edit of event.edits) {
                                            const lines = content.split('\n');
                                            const rangeStart = Math.max(0, edit.startLine - 1);
                                            const rangeEnd = Math.min(lines.length, edit.endLine);
                                            const rangeContent = lines.slice(rangeStart, rangeEnd).join('\n');
                                            const newRangeContent = rangeContent.replace(
                                                edit.oldContent,
                                                edit.newContent,
                                            );
                                            const newLines = [
                                                ...lines.slice(0, rangeStart),
                                                ...newRangeContent.split('\n'),
                                                ...lines.slice(rangeEnd),
                                            ];
                                            content = newLines.join('\n');
                                        }
                                        doc.content = content;
                                        updateArtifact(doc.artifactId, { content: doc.content });
                                    }
                                    break;
                                }

                                case 'document_complete': {
                                    // Try version first, then fall back to checking all keys with this name
                                    // (pendingVersion becomes version after finalization)
                                    let docKey = `${event.name}_${event.version}`;
                                    let completedDoc = streaming.streamingDocs.get(docKey);

                                    // If not found, search for any doc with matching name
                                    if (!completedDoc) {
                                        for (const [key, doc] of streaming.streamingDocs.entries()) {
                                            if (key.startsWith(`${event.name}_`)) {
                                                completedDoc = doc;
                                                docKey = key;
                                                break;
                                            }
                                        }
                                    }

                                    if (completedDoc) {
                                        setStreamingComplete(completedDoc.artifactId);
                                        streaming.streamingDocs.delete(docKey);
                                        onArtifactComplete?.();
                                    }
                                    break;
                                }

                                case 'status_update':
                                    setMessages((prev) =>
                                        prev.map((msg) =>
                                            msg.id === streamingMsgId || msg.isStreaming
                                                ? { ...msg, status: event.status }
                                                : msg,
                                        ),
                                    );
                                    break;

                                case 'done':
                                case 'done_ext':
                                    setMessages((prev) =>
                                        prev.map((msg) =>
                                            msg.id === streamingMsgId || msg.isStreaming
                                                ? {
                                                      ...msg,
                                                      blocks: [...streaming.blocks],
                                                      isStreaming: false,
                                                      status: undefined,
                                                  }
                                                : msg,
                                        ),
                                    );
                                    setIsLoading(false);
                                    break;

                                default:
                                    console.log('Unknown event type:', event.type);
                            }
                        } catch (e) {
                            console.error('Failed to parse SSE data:', e);
                        }
                    }
                }
            } finally {
                // Ensure message is finalized even if stream ends unexpectedly
                setMessages((prev) => prev.map((msg) => (msg.isStreaming ? { ...msg, isStreaming: false } : msg)));
                setIsLoading(false);
                streamingStateRef.current = null;
            }
        },
        [
            addArtifact,
            updateArtifact,
            setCurrentArtifact,
            setStreamingComplete,
            setMessages,
            setIsLoading,
            onArtifactComplete,
        ],
    );

    return { readStream };
}
