'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import type { ChatState, Message, StreamBlock, StreamEvent } from '../types';
import { useStreamingContext } from './streaming-provider';

export type ChatContextValue = {
    state: ChatState;
    sendMessage: (content: string) => void;
    stopGeneration: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

// TODO: Change to real endpoint when backend is ready
const API_ENDPOINT = '/api/stream-artifact';

type ChatProviderProps = {
    children: ReactNode;
    initialMessages?: Message[];
};

/** Create a user message with a single text block */
function createUserMessage(content: string): Message {
    const id = uuidv4();
    return {
        id,
        role: 'user',
        blocks: [{ id: `text-${id}`, type: 'text', content }],
        createdAt: new Date(),
    };
}

/** Streaming state for building assistant messages */
type StreamingState = {
    blocks: StreamBlock[];
    currentTextBlockId: string | null;
    currentReasoningBlockId: string | null;
    streamingDocs: Map<string, { artifactId: string; content: string }>;
};

export function ChatProvider({ children, initialMessages = [] }: ChatProviderProps) {
    const { subscribe, startStream, abort } = useStreamingContext();
    const { addArtifact, updateArtifact, setCurrentArtifact, setStreamingComplete } = useArtifactContext();

    const [state, setState] = useState<ChatState>({
        messages: initialMessages,
        isGenerating: false,
        error: null,
        streamingMessageId: null,
    });

    // Streaming state ref to avoid stale closures
    const streamingStateRef = useRef<StreamingState | null>(null);

    // Helper to update the streaming message blocks
    const updateStreamingBlocks = useCallback((streamingMessageId: string, blocks: StreamBlock[]) => {
        setState((prev) => ({
            ...prev,
            messages: prev.messages.map((msg) =>
                msg.id === streamingMessageId ? { ...msg, blocks: [...blocks] } : msg,
            ),
        }));
    }, []);

    const handleStreamEvent = useCallback(
        (event: StreamEvent) => {
            const streaming = streamingStateRef.current;
            if (!streaming) return;

            const streamingMessageId = state.streamingMessageId;
            if (!streamingMessageId) return;

            switch (event.type) {
                // Text content
                case 'delta': {
                    if (!event.text) break;

                    if (!streaming.currentTextBlockId) {
                        streaming.currentTextBlockId = event.blockId || `text-${Date.now()}`;
                        streaming.blocks.push({ id: streaming.currentTextBlockId, type: 'text', content: '' });
                    }

                    const textIdx = streaming.blocks.findIndex((b) => b.id === streaming.currentTextBlockId);
                    if (textIdx !== -1 && streaming.blocks[textIdx].type === 'text') {
                        streaming.blocks[textIdx] = {
                            ...streaming.blocks[textIdx],
                            content: streaming.blocks[textIdx].content + event.text,
                        } as StreamBlock;
                        updateStreamingBlocks(streamingMessageId, streaming.blocks);
                    }
                    break;
                }

                case 'created':
                    // Update message ID from server
                    if (event.id) {
                        setState((prev) => ({
                            ...prev,
                            messages: prev.messages.map((msg) =>
                                msg.id === prev.streamingMessageId ? { ...msg, id: event.id } : msg,
                            ),
                            streamingMessageId: event.id,
                        }));
                    }
                    break;

                // Reasoning/thinking
                case 'reasoning_start':
                    streaming.currentReasoningBlockId = event.blockId || `reasoning-${Date.now()}`;
                    streaming.blocks.push({
                        id: streaming.currentReasoningBlockId,
                        type: 'reasoning',
                        content: '',
                    });
                    updateStreamingBlocks(streamingMessageId, streaming.blocks);
                    break;

                case 'reasoning_delta': {
                    const text = event.text || event.content;
                    if (text && streaming.currentReasoningBlockId) {
                        const idx = streaming.blocks.findIndex((b) => b.id === streaming.currentReasoningBlockId);
                        if (idx !== -1 && streaming.blocks[idx].type === 'reasoning') {
                            streaming.blocks[idx] = {
                                ...streaming.blocks[idx],
                                content: streaming.blocks[idx].content + text,
                            } as StreamBlock;
                            updateStreamingBlocks(streamingMessageId, streaming.blocks);
                        }
                    }
                    break;
                }

                case 'reasoning_done':
                    if (streaming.currentReasoningBlockId && event.durationMs !== undefined) {
                        const idx = streaming.blocks.findIndex((b) => b.id === streaming.currentReasoningBlockId);
                        if (idx !== -1 && streaming.blocks[idx].type === 'reasoning') {
                            streaming.blocks[idx] = {
                                ...streaming.blocks[idx],
                                durationMs: event.durationMs,
                            } as StreamBlock;
                            updateStreamingBlocks(streamingMessageId, streaming.blocks);
                        }
                    }
                    streaming.currentReasoningBlockId = null;
                    break;

                // Tool calls
                case 'tool_start':
                    streaming.blocks.push({
                        id: event.id || `tool-${Date.now()}`,
                        type: 'tool_call',
                        content: '',
                        toolName: event.tool,
                        toolInput: {},
                        toolCallId: event.id,
                    });
                    updateStreamingBlocks(streamingMessageId, streaming.blocks);
                    break;

                case 'tool_result': {
                    const tIdx = streaming.blocks.findIndex((b) => b.type === 'tool_call' && b.toolCallId === event.id);
                    if (tIdx !== -1 && streaming.blocks[tIdx].type === 'tool_call') {
                        streaming.blocks[tIdx] = {
                            ...streaming.blocks[tIdx],
                            content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
                            toolOutput: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
                            toolSuccess: event.success,
                        } as StreamBlock;
                        updateStreamingBlocks(streamingMessageId, streaming.blocks);
                    }
                    break;
                }

                // Documents/artifacts
                case 'document_start': {
                    const docKey = `${event.name}_${event.pendingVersion}`;
                    const artifactId = `doc-${event.name}-v${event.pendingVersion}`;
                    streaming.streamingDocs.set(docKey, { artifactId, content: '' });
                    addArtifact(
                        {
                            id: artifactId,
                            identifier: event.name,
                            title: event.title || event.name,
                            type: 'text/markdown',
                            content: '',
                            messageId: streamingMessageId,
                        },
                        true, // isStreaming
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
                            const newRangeContent = rangeContent.replace(edit.oldContent, edit.newContent);
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
                    }
                    break;
                }

                // Status & control
                case 'status_update':
                    setState((prev) => ({
                        ...prev,
                        messages: prev.messages.map((msg) =>
                            msg.id === prev.streamingMessageId || msg.isStreaming
                                ? { ...msg, status: event.status }
                                : msg,
                        ),
                    }));
                    break;

                case 'error':
                    setState((prev) => ({
                        ...prev,
                        isGenerating: false,
                        error: new Error(event.error),
                        streamingMessageId: null,
                    }));
                    streamingStateRef.current = null;
                    break;

                case 'done':
                case 'done_ext':
                    setState((prev) => ({
                        ...prev,
                        messages: prev.messages.map((msg) =>
                            msg.id === prev.streamingMessageId || msg.isStreaming
                                ? { ...msg, blocks: [...streaming.blocks], isStreaming: false, status: undefined }
                                : msg,
                        ),
                        isGenerating: false,
                        streamingMessageId: null,
                    }));
                    streamingStateRef.current = null;
                    break;

                default:
                    // Unknown event types are silently ignored
                    break;
            }
        },
        [
            state.streamingMessageId,
            updateStreamingBlocks,
            addArtifact,
            updateArtifact,
            setCurrentArtifact,
            setStreamingComplete,
        ],
    );

    const sendMessage = useCallback(
        (content: string) => {
            if (!content.trim() || state.isGenerating) return;

            const userMessage = createUserMessage(content);
            const assistantMessageId = uuidv4();

            // Initialize streaming state
            streamingStateRef.current = {
                blocks: [],
                currentTextBlockId: null,
                currentReasoningBlockId: null,
                streamingDocs: new Map(),
            };

            // Create empty assistant message
            const assistantMessage: Message = {
                id: assistantMessageId,
                role: 'assistant',
                blocks: [],
                isStreaming: true,
                createdAt: new Date(),
            };

            setState((prev) => ({
                ...prev,
                messages: [...prev.messages, userMessage, assistantMessage],
                isGenerating: true,
                error: null,
                streamingMessageId: assistantMessageId,
            }));

            // TODO: Use POST with messages when backend is ready
            startStream(API_ENDPOINT, { method: 'GET' });
        },
        [state.isGenerating, startStream],
    );

    const stopGeneration = useCallback(() => {
        abort();

        const streaming = streamingStateRef.current;
        setState((prev) => ({
            ...prev,
            messages: prev.messages.map((msg) =>
                msg.id === prev.streamingMessageId || msg.isStreaming
                    ? { ...msg, blocks: streaming?.blocks ?? [], isStreaming: false, status: undefined }
                    : msg,
            ),
            isGenerating: false,
            streamingMessageId: null,
        }));
        streamingStateRef.current = null;
    }, [abort]);

    useEffect(() => {
        const unsubscribe = subscribe(handleStreamEvent);
        return unsubscribe;
    }, [subscribe, handleStreamEvent]);

    return <ChatContext.Provider value={{ state, sendMessage, stopGeneration }}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error('useChatContext must be used within a ChatProvider');
    }
    return context;
}
