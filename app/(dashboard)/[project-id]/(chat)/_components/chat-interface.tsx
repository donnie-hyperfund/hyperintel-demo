'use client';

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StreamBlock } from '@/common/ai/agent/types';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { createApiClient } from '@/lib/api/client';
import { sendAction } from '@/lib/api/requests/worker/chat';
import ChatConversation from './chat-conversation/chat-conversation';
import ChatMessageForm from './chat-panel/chat-message-form';
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
    const readStream = useCallback(async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Accumulated blocks for this streaming message
        const blocks: any[] = [];
        let currentTextBlockId: string | null = null;
        let currentReasoningBlockId: string | null = null;
        const streamingMsgId = `streaming-${Date.now()}`;

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
                                // Reasoning block complete
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
                                        prev.map((msg) => (msg.id === streamingMsgId ? { ...msg, id: event.id } : msg)),
                                    );
                                }
                                break;

                            case 'document_start':
                                console.log('Document start:', event.name);
                                // TODO: Handle document panel
                                break;

                            case 'document_delta':
                                // TODO: Handle document streaming
                                break;

                            case 'document_complete':
                                console.log('Document complete:', event.name, 'v' + event.version);
                                // TODO: Show document card
                                break;

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
    }, []);

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
        <ResizablePanelGroup id="chat-panel-group" direction="horizontal" className="h-full">
            {/* Chat Panel */}
            <ResizablePanel defaultSize={75} minSize={40} maxSize={80}>
                <div className="bg-card flex flex-col border-r border-border relative h-full">
                    <ChatConversation messages={messages} isLoading={isLoading} ref={chatConversationRef} />

                    <ChatMessageForm
                        ref={chatMessageFormRef}
                        onSubmit={handleSend}
                        className="absolute bottom-0 left-0 right-0"
                    />
                </div>
            </ResizablePanel>

            <ResizableHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

            {/* Artifacts Panel - placeholder for now */}
            <ResizablePanel defaultSize={25} minSize={20}>
                <div className="bg-card flex flex-col h-full overflow-hidden">
                    <div className="p-4 border-b border-border">
                        <h3 className="font-semibold">Documents</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                        <div className="text-muted-foreground text-center py-8">Documents will appear here</div>
                    </div>
                </div>
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}
