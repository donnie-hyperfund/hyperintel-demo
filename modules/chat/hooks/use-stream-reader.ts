'use client';

import { useCallback, useRef } from 'react';
import { AsyncEventQueue } from '@/lib/async-event-queue';
import type { ArtifactContextValue } from '@/modules/chat/providers/artifact-provider';
import { getArtifactContent } from '@/modules/chat/providers/artifact-provider/utils';
import type { Artifact } from '@/modules/chat/types';
import type { Message, StreamBlock, TokenUsage } from '../types';

/** Streaming state for building assistant messages */
type StreamingState = {
    blocks: StreamBlock[];
    currentTextBlockId: string | null;
    currentReasoningBlockId: string | null;
    streamingDocs: Map<string, { artifactId: string; content: string; version: number }>;
};

/** Document event for queue processing */
type DocumentEvent = {
    type: 'document_start' | 'document_delta' | 'document_edit' | 'document_complete';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any;
};

type UseStreamReaderOptions = {
    /** Artifact context for document streaming */
    artifactContext: Pick<ArtifactContextValue, 'getArtifact' | 'addArtifact' | 'updateArtifact'>;
    /** Callback to update messages state */
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    /** Callback to set loading state */
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
    /** Called when a streamed artifact should be shown in the preview panel */
    handleArtifactOpen?: (artifactId: string, version: number) => void;
    /** Revalidate artifact from API - updates list in SWR cache and context state */
    revalidateArtifactByKeyAndVersion?: (keyId: string, version: number) => void;
    /** Called when token usage is received from the done event */
    onTokenUsage?: (usage: TokenUsage) => void;
    /** Fetch artifact from API when not available in store */
    fetchArtifact?: (artifactKey: string, version: number) => Promise<Artifact | null>;
    /** Called when a document stream starts */
    onDocumentStart?: () => void;
};

/**
 * Hook that provides a `readStream` function for processing SSE streams
 * and building StreamBlock-based messages.
 */
export function useStreamReader({
    artifactContext,
    setMessages,
    setIsLoading,
    handleArtifactOpen,
    revalidateArtifactByKeyAndVersion,
    onTokenUsage,
    fetchArtifact,
    onDocumentStart,
}: UseStreamReaderOptions) {
    const { getArtifact, addArtifact, updateArtifact } = artifactContext;

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

            // Document event handler for sequential processing with async support
            const handleDocumentEvent = async (event: DocumentEvent) => {
                const { type, payload } = event;

                switch (type) {
                    case 'document_start': {
                        const artifactId = payload.name;
                        const now = new Date().toISOString();

                        // Notify that a document stream has started
                        onDocumentStart?.();

                        if (payload.mode === 'create') {
                            streaming.streamingDocs.set(artifactId, {
                                artifactId,
                                content: '',
                                version: 1,
                            });

                            addArtifact(
                                {
                                    id: artifactId,
                                    key: payload.name,
                                    title: payload.title,
                                    version: 1,
                                    proposed_version: {
                                        id: '',
                                        version: 1,
                                        content: '',
                                        status: 'proposed',
                                        created_at: now,
                                        updated_at: now,
                                    },
                                    created_at: now,
                                    updated_at: now,
                                    isStreaming: true,
                                    isUpdating: false,
                                    isLoading: false,
                                },
                                1,
                            );

                            handleArtifactOpen?.(artifactId, 1);
                        } else if (payload.mode === 'edit') {
                            const loadedVersion = payload.loadedVersion ?? 1;
                            let existingArtifact = getArtifact(artifactId, loadedVersion);

                            // Fetch artifact if not in store
                            if (!existingArtifact && fetchArtifact) {
                                existingArtifact = await fetchArtifact(artifactId, loadedVersion);
                            }

                            const newVersion = loadedVersion + 1;

                            streaming.streamingDocs.set(artifactId, {
                                artifactId,
                                content: existingArtifact ? (getArtifactContent(existingArtifact) ?? '') : '',
                                version: newVersion,
                            });

                            const loadedContent = existingArtifact ? getArtifactContent(existingArtifact) : undefined;

                            addArtifact(
                                {
                                    id: artifactId,
                                    key: payload.name,
                                    title: payload.title,
                                    version: newVersion,
                                    current_version: loadedContent
                                        ? {
                                              id: '',
                                              version: loadedVersion,
                                              content: loadedContent,
                                              status: 'approved',
                                              created_at: now,
                                              updated_at: now,
                                          }
                                        : undefined,
                                    proposed_version: {
                                        id: '',
                                        version: newVersion,
                                        content: loadedContent ?? '',
                                        status: 'proposed',
                                        created_at: now,
                                        updated_at: now,
                                    },
                                    created_at: now,
                                    updated_at: now,
                                    isStreaming: true,
                                    isUpdating: true,
                                },
                                newVersion,
                            );

                            handleArtifactOpen?.(artifactId, newVersion);
                        }
                        break;
                    }

                    case 'document_delta': {
                        const doc = streaming.streamingDocs.get(payload.name);
                        if (doc) {
                            doc.content += payload.content;
                            updateArtifact(
                                doc.artifactId,
                                {
                                    proposed_version: { content: doc.content },
                                },
                                doc.version,
                            );
                        } else {
                            console.warn('[stream-reader] document_delta: doc not found for', payload.name);
                        }
                        break;
                    }

                    case 'document_edit': {
                        const doc = streaming.streamingDocs.get(payload.name);

                        if (doc && payload.edits) {
                            let content = doc.content;
                            for (const edit of payload.edits) {
                                const lines = content.split('\n');
                                const rangeStart = Math.max(0, edit.startLine - 1);
                                const rangeEnd = Math.min(lines.length, edit.endLine);
                                const rangeContent = lines.slice(rangeStart, rangeEnd).join('\n');
                                const newRangeContent = rangeContent.replace(edit.oldContent, edit.newContent);
                                const newLines = [
                                    ...lines.slice(0, rangeStart),
                                    ...newRangeContent.split('\n'),
                                    ...lines.slice(rangeEnd),
                                ];
                                content = newLines.join('\n');
                            }
                            doc.content = content;

                            updateArtifact(
                                doc.artifactId,
                                {
                                    proposed_version: { content: doc.content },
                                    isUpdating: false,
                                    isStreaming: false,
                                },
                                doc.version,
                            );
                            revalidateArtifactByKeyAndVersion?.(doc.artifactId, doc.version);
                        }
                        break;
                    }

                    case 'document_complete': {
                        const completedDoc = streaming.streamingDocs.get(payload.name);
                        if (!completedDoc) {
                            console.warn('[stream-reader] document_complete: doc not found for', payload.name);
                            break;
                        }

                        updateArtifact(
                            completedDoc.artifactId,
                            {
                                isStreaming: false,
                                isUpdating: false,
                                version: completedDoc.version,
                                proposed_version: { version: completedDoc.version, status: 'proposed' },
                            },
                            completedDoc.version,
                        );
                        streaming.streamingDocs.delete(payload.name);
                        revalidateArtifactByKeyAndVersion?.(completedDoc.artifactId, completedDoc.version);
                        break;
                    }

                    default:
                        console.warn('[stream-reader] unknown document event type:', type);
                        break;
                }
            };

            // Queue for processing document events sequentially without blocking other events
            const documentQueue = new AsyncEventQueue<DocumentEvent>(handleDocumentEvent);

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

                            // TODO: handled on done event for now
                            // if (event.error) {
                            //     console.error('Stream error:', event.error);
                            //     break;
                            // }

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

                                    if (event.success === true && event.tool === 'approve_document') {
                                        try {
                                            const parsed =
                                                typeof event.result === 'string'
                                                    ? JSON.parse(event.result)
                                                    : event.result;

                                            if (parsed.name && parsed.version) {
                                                revalidateArtifactByKeyAndVersion?.(parsed.name, parsed.version);
                                            }
                                        } catch (err) {
                                            console.warn(
                                                '[stream-reader] approve_document: failed to parse tool_result',
                                                err,
                                            );
                                        }
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

                                case 'search_start': {
                                    const searchBlockId = event.blockId || `search-${Date.now()}`;
                                    streaming.blocks.push({
                                        id: searchBlockId,
                                        type: 'search',
                                        content: event.query,
                                        searchQuery: event.query,
                                    });
                                    updateStreamingMessage();
                                    break;
                                }

                                case 'search_results': {
                                    // Update search block with result count and mark complete
                                    const searchIdx = streaming.blocks.findIndex(
                                        (b) => b.id === event.blockId && b.type === 'search',
                                    );
                                    if (searchIdx !== -1 && streaming.blocks[searchIdx].type === 'search') {
                                        streaming.blocks[searchIdx] = {
                                            ...streaming.blocks[searchIdx],
                                            resultCount: event.resultCount,
                                            isComplete: true,
                                        } as StreamBlock;
                                        updateStreamingMessage();
                                    }
                                    break;
                                }

                                case 'citation': {
                                    // Find the parent text block and add citation to it
                                    const textIdx = streaming.blocks.findIndex(
                                        (b) => b.id === event.parentTextBlockId && b.type === 'text',
                                    );
                                    if (textIdx !== -1 && streaming.blocks[textIdx].type === 'text') {
                                        const textBlock = streaming.blocks[textIdx];
                                        streaming.blocks[textIdx] = {
                                            ...textBlock,
                                            citations: [
                                                ...(textBlock.citations || []),
                                                {
                                                    url: event.url,
                                                    title: event.title,
                                                    cited_text: event.citedText,
                                                    start_index: event.startIndex,
                                                    end_index: event.endIndex,
                                                    provider: 'anthropic', // Assume Anthropic for now
                                                },
                                            ],
                                        } as StreamBlock;
                                        updateStreamingMessage();
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

                                case 'document_start':
                                case 'document_delta':
                                case 'document_edit':
                                case 'document_complete':
                                    documentQueue.push({ type: event.type, payload: event });
                                    break;

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
                                                      ...(event.error && { isError: true }),
                                                  }
                                                : msg,
                                        ),
                                    );
                                    setIsLoading(false);
                                    if (event.tokenBreakdown && onTokenUsage) {
                                        onTokenUsage({
                                            usedTokens: event.usedTokens ?? 0,
                                            tokenBreakdown: event.tokenBreakdown,
                                        });
                                    }
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
            getArtifact,
            addArtifact,
            updateArtifact,
            setMessages,
            setIsLoading,
            handleArtifactOpen,
            revalidateArtifactByKeyAndVersion,
            onTokenUsage,
            fetchArtifact,
            onDocumentStart,
        ],
    );

    return { readStream };
}
