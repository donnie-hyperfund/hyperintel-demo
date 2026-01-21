'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect, useRef, useState } from 'react';
import ArtifactsPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/artifacts-panel';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { createApiClient } from '@/lib/api/client';
import { sendAction } from '@/lib/api/requests/worker/chat';
import { cn } from '@/lib/utils';
import { useStreamReader } from '@/modules/chat/hooks/use-stream-reader';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import type { Message } from '@/modules/chat/types';
import ChatPanel from './chat-panel';
import type { ChatMessageFormValues } from './chat-panel/chat-message-form/schema';

// Re-export Message type for consumers
export type { Message } from '@/modules/chat/types';

interface ChatInterfaceProps {
    chatId?: string; // Optional - if not provided, will create chat on first message
    projectId: string;
    initialMessage?: string;
}

export default function ChatInterface({ chatId, projectId, initialMessage }: ChatInterfaceProps) {
    const artifactContext = useArtifactContext();
    const { isVisible: isArtifactsPanelVisible } = artifactContext;

    const { getToken } = useAuth();
    const chatConversationRef = useRef<HTMLDivElement>(null);
    const chatMessageFormRef = useRef<HTMLFormElement>(null);

    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(!chatId); // Not loading if no chatId yet
    const [currentChatId, setCurrentChatId] = useState<string | null>(chatId || null);
    const skipNextLoad = useRef(false); // Flag to skip message reload after creating new chat

    // Use the stream reader hook for SSE processing
    const { readStream } = useStreamReader({ artifactContext, setMessages, setIsLoading });

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
