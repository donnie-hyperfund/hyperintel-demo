'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import ArtifactsPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/artifacts-panel';
import type { StreamBlock } from '@/common/ai/agent/types';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { createApiClient } from '@/lib/api/client';
import { sendAction } from '@/lib/api/requests/worker/chat';
import { cn } from '@/lib/utils';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import ChatPanel from './chat-panel';
import type { ChatMessageFormValues } from './chat-panel/chat-message-form/schema';

// Message type using StreamBlock[] as primary data source
export type Message = {
    id: string;
    role: 'user' | 'assistant';
    blocks: StreamBlock[];
    isStreaming?: boolean;
    status?: string; // Current status from sys_status events
};

interface ChatInterfaceProps {
    chatId?: string; // Optional - if not provided, will create chat on first message
    projectId: string;
    initialMessage?: string;
}

export default function ChatInterface({ chatId, projectId, initialMessage }: ChatInterfaceProps) {
    const {
        isVisible: isArtifactsPanelVisible,
        addArtifact,
        updateArtifact,
        setCurrentArtifact,
    } = useArtifactContext();

    const { getToken } = useAuth();
    const chatConversationRef = useRef<HTMLDivElement>(null);
    const chatMessageFormRef = useRef<HTMLFormElement>(null);

    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(!chatId); // Not loading if no chatId yet
    const [currentChatId, setCurrentChatId] = useState<string | null>(chatId || null);
    const skipNextLoad = useRef(false); // Flag to skip message reload after creating new chat

    // Padding adjustment for message form
    useEffect(() => {
        const formElement = chatMessageFormRef.current;
        const conversationElement = chatConversationRef.current;

        if (!formElement || !conversationElement) return;

        const updatePadding = () => {
            const height = formElement.offsetHeight;
            conversationElement.style.paddingBottom = `${height + 16}px`;
        };

        updatePadding();

        const resizeObserver = new ResizeObserver(updatePadding);
        resizeObserver.observe(formElement);

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    // Load chat history with blocks from API (only if we have a chatId)
    useEffect(() => {
        if (!currentChatId) {
            setIsInitialLoading(false);
            return;
        }

        // Skip reload if we just created this chat
        if (skipNextLoad.current) {
            skipNextLoad.current = false;
            return;
        }

        const loadMessages = async () => {
            try {
                const res = await fetch(`/api/projects/${projectId}/chats/${currentChatId}/messages`);
                if (res.ok) {
                    const data = await res.json();
                    // API returns { data: [...], pagination: {...} }
                    // API returns DESC order (newest first), reverse for display (newest at bottom)
                    const apiMessages =
                        data.data?.map((m: any) => {
                            // LEGACY: fallback for old messages with content but no blocks (remove after DB nuke)
                            const blocks =
                                m.blocks && m.blocks.length > 0
                                    ? m.blocks
                                    : m.content
                                      ? [{ id: m.id, type: 'text', content: m.content }]
                                      : [];
                            return {
                                id: m.id,
                                role: m.role,
                                blocks,
                                isStreaming: false,
                            };
                        }) || [];
                    setMessages(apiMessages.reverse());
                }
            } catch (error) {
                console.error('Error loading messages:', error);
            } finally {
                setIsInitialLoading(false);
            }
        };
        loadMessages();
    }, [currentChatId, projectId]);

    // Auto-send initial message after messages load
    const hasAutoSent = useRef(false);
    useEffect(() => {
        if (initialMessage && !isInitialLoading && !hasAutoSent.current) {
            hasAutoSent.current = true;
            handleSend({ message: initialMessage });
        }
    }, [initialMessage, isInitialLoading]);

    // Build StreamBlock[] from SSE events
    const readStream = useCallback(
        async (stream: ReadableStream<Uint8Array>) => {
            const reader = stream.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            // Accumulated blocks for this streaming message
            const blocks: any[] = [];
            let currentTextBlockId: string | null = null;
            let currentReasoningBlockId: string | null = null;
            const streamingMsgId = `streaming-${Date.now()}`;

            // Track streaming documents: Map<"name_pendingVersion", { artifactId, content }>
            const streamingDocs = new Map<string, { artifactId: string; content: string }>();

            // Add empty assistant message to start streaming into
            setMessages((prev) => [...prev, { id: streamingMsgId, role: 'assistant', blocks: [], isStreaming: true }]);

            // Helper to update streaming message
            const updateStreamingMessage = () => {
                setMessages((prev) =>
                    prev.map((msg) => (msg.id === streamingMsgId ? { ...msg, blocks: [...blocks] } : msg)),
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
                                case 'reasoning_start':
                                    // Create new reasoning block
                                    currentReasoningBlockId = event.blockId || `reasoning-${Date.now()}`;
                                    blocks.push({
                                        id: currentReasoningBlockId,
                                        type: 'reasoning',
                                        content: '',
                                    });
                                    updateStreamingMessage();
                                    break;

                                case 'reasoning_delta':
                                    // Append to current reasoning block (immutable update)
                                    if (event.text || event.content) {
                                        const idx = blocks.findIndex((b) => b.id === currentReasoningBlockId);
                                        if (idx !== -1) {
                                            blocks[idx] = {
                                                ...blocks[idx],
                                                content: (blocks[idx].content || '') + (event.text || event.content),
                                            };
                                            updateStreamingMessage();
                                        }
                                    }
                                    break;

                                case 'reasoning_done':
                                    // Reasoning block complete - capture duration
                                    if (currentReasoningBlockId && event.durationMs !== undefined) {
                                        const idx = blocks.findIndex((b) => b.id === currentReasoningBlockId);
                                        if (idx !== -1) {
                                            blocks[idx] = {
                                                ...blocks[idx],
                                                durationMs: event.durationMs,
                                            };
                                            updateStreamingMessage();
                                        }
                                    }
                                    currentReasoningBlockId = null;
                                    break;

                                case 'tool_start':
                                    // Create tool_call block
                                    blocks.push({
                                        id: event.id || `tool-${Date.now()}`,
                                        type: 'tool_call',
                                        content: '',
                                        toolName: event.tool,
                                        toolCallId: event.id,
                                    });
                                    updateStreamingMessage();
                                    break;

                                case 'tool_result':
                                    {
                                        // Update tool block with result (immutable update)
                                        const tIdx = blocks.findIndex((b) => b.toolCallId === event.id);
                                        if (tIdx !== -1) {
                                            blocks[tIdx] = {
                                                ...blocks[tIdx],
                                                content:
                                                    typeof event.result === 'string'
                                                        ? event.result
                                                        : JSON.stringify(event.result),
                                                toolResult: event.result,
                                                toolSuccess: event.success,
                                            };
                                            updateStreamingMessage();
                                        }
                                    }
                                    break;

                                case 'delta':
                                    // Get or create text block, append content (immutable update)
                                    if (event.text) {
                                        if (!currentTextBlockId) {
                                            currentTextBlockId = event.blockId || `text-${Date.now()}`;
                                            blocks.push({ id: currentTextBlockId, type: 'text', content: '' });
                                        }
                                        const textIdx = blocks.findIndex((b: any) => b.id === currentTextBlockId);
                                        if (textIdx !== -1) {
                                            blocks[textIdx] = {
                                                ...blocks[textIdx],
                                                content: (blocks[textIdx].content || '') + event.text,
                                            };
                                            updateStreamingMessage();
                                        }
                                    }
                                    break;

                                case 'created':
                                    // Update message ID from server
                                    if (event.id) {
                                        setMessages((prev) =>
                                            prev.map((msg) =>
                                                msg.id === streamingMsgId ? { ...msg, id: event.id } : msg,
                                            ),
                                        );
                                    }
                                    break;

                                case 'document_start': {
                                    console.log('document_start', event);
                                    const docKey = `${event.name}_${event.pendingVersion}`;
                                    const artifactId = `doc-${event.name}-v${event.pendingVersion}`;
                                    streamingDocs.set(docKey, { artifactId, content: '' });
                                    addArtifact({
                                        id: artifactId,
                                        identifier: event.name,
                                        title: event.title || event.name,
                                        type: 'text/markdown',
                                        content: '',
                                        messageId: streamingMsgId,
                                    });
                                    setCurrentArtifact(artifactId);
                                    break;
                                }

                                case 'document_delta': {
                                    console.log('document_delta', event);
                                    const docKey = `${event.name}_${event.pendingVersion}`;
                                    const doc = streamingDocs.get(docKey);
                                    if (doc) {
                                        doc.content += event.content;
                                        updateArtifact(doc.artifactId, { content: doc.content });
                                    }
                                    break;
                                }

                                case 'document_edit': {
                                    // Precision edits applied to document draft
                                    console.log('document_edit', event);
                                    const docKey = `${event.name}_${event.pendingVersion}`;
                                    const doc = streamingDocs.get(docKey);
                                    if (doc && event.edits) {
                                        // Apply edits to local content to keep it in sync
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
                                    console.log('document_complete', event);
                                    // Clear tracking for this document
                                    const docKey = `${event.name}_${event.version}`;
                                    streamingDocs.delete(docKey);
                                    break;
                                }

                                case 'status_update':
                                    // Update status indicator
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
                                    // Finalize message, clear status, stop loading together to avoid race
                                    // TODO: "thought for X seconds"
                                    setMessages((prev) =>
                                        prev.map((msg) =>
                                            msg.id === streamingMsgId || msg.isStreaming
                                                ? { ...msg, blocks: [...blocks], isStreaming: false, status: undefined }
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
            }
        },
        [addArtifact, updateArtifact, setCurrentArtifact],
    );

    const handleSend = async (data: ChatMessageFormValues) => {
        if (!data.message.trim()) return;

        // User message as a single text block
        const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: 'user',
            blocks: [{ id: `text-${Date.now()}`, type: 'text', content: data.message }],
        };

        // Add user message
        setMessages((prev) => [...prev, userMessage]);
        setIsLoading(true);

        // Get access token for worker auth
        const accessToken = (await getToken()) ?? '';

        try {
            // If no chatId, create a new chat first
            let chatIdToUse = currentChatId;
            if (!chatIdToUse) {
                const newChat = await createApiClient(getToken).chats.create(projectId);
                chatIdToUse = newChat.id;

                // Skip the message reload effect
                skipNextLoad.current = true;
                setCurrentChatId(chatIdToUse);

                // Update URL without navigation using history API
                window.history.replaceState(null, '', `/${projectId}/chats/${chatIdToUse}`);
            }

            const response = await sendAction(
                {
                    message: data.message,
                    chatId: chatIdToUse,
                },
                accessToken,
            );

            // Use streaming response
            if (response.body) {
                await readStream(response.body);
            }
        } catch (error) {
            console.error('Error sending message:', error);
            setIsLoading(false);
        }
    };

    return (
        <ResizablePanelGroup id="chat-interface-panels" direction="horizontal" className="h-full">
            {/* Chat Panel */}
            <ResizablePanel
                id="chat-panel"
                order={1}
                defaultSize={60}
                minSize={40}
                maxSize={80}
                className={cn(isArtifactsPanelVisible && 'shadow-[inset_-4px_0_48px_rgba(0,0,0,0.25)]')}
            >
                <ChatPanel
                    messages={messages}
                    isLoading={isLoading}
                    onSend={handleSend}
                    conversationRef={chatConversationRef}
                    formRef={chatMessageFormRef}
                />
            </ResizablePanel>

            <ResizableHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

            {isArtifactsPanelVisible && (
                <>
                    <ResizableHandle />

                    {/* Artifacts Panel */}
                    <ResizablePanel id="artifacts-panel" order={2} defaultSize={40} minSize={20}>
                        <ArtifactsPanel />
                    </ResizablePanel>
                </>
            )}
        </ResizablePanelGroup>
    );
}
