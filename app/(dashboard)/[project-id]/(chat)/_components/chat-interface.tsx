'use client';

import { useEffect, useRef } from 'react';
import ArtifactsPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/artifacts-panel';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import ChatPanel from './chat-panel';

// Re-export Message type for consumers
export type { Message } from '@/modules/chat/types';

interface ChatInterfaceProps {
    /** Initial message to send automatically */
    initialMessage?: string;
}

export default function ChatInterface({ initialMessage }: ChatInterfaceProps) {
    const { isVisible: isArtifactsPanelVisible } = useArtifactContext();
    const { chatId, loadMessages, sendMessage } = useChatContext();

    const chatConversationRef = useRef<HTMLDivElement>(null);
    const chatMessageFormRef = useRef<HTMLDivElement>(null);

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

    // Load chat history from API when chatId changes
    useEffect(() => {
        if (chatId) {
            loadMessages();
        }
    }, [chatId, loadMessages]);

    // Auto-send initial message after component mounts
    const hasAutoSent = useRef(false);
    useEffect(() => {
        if (initialMessage && !hasAutoSent.current) {
            hasAutoSent.current = true;
            sendMessage(initialMessage);
        }
    }, [initialMessage, sendMessage]);

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
                <ChatPanel conversationRef={chatConversationRef} formRef={chatMessageFormRef} />
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
