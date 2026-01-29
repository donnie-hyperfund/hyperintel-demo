'use client';

import { Fragment, useEffect, useRef } from 'react';
import ArtifactPreviewPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel';
import ArtifactsPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/artifacts-panel';
import ResourcesPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/resources-panel';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import ChatPanel from './chat-panel';

// Re-export Message type for consumers
export type { Message } from '@/modules/chat/types';

interface ChatInterfaceProps {
    /** Initial message to send automatically */
    initialMessage?: string;
}

export default function ChatInterface({ initialMessage }: ChatInterfaceProps) {
    const { panelState, closePanel } = useActivePanelContext();
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

    const isPanelOpen = panelState !== null;
    const activePanel = panelState?.panel ?? null;

    return (
        <ResizablePanelGroup id="chat-interface-panels" direction="horizontal" className="h-full">
            {/* Chat Panel */}
            <ResizablePanel
                id="chat-panel"
                order={1}
                defaultSize={60}
                minSize={60}
                maxSize={80}
                className={cn(isPanelOpen && 'shadow-[inset_-4px_0_48px_rgba(0,0,0,0.25)]')}
            >
                <ChatPanel conversationRef={chatConversationRef} formRef={chatMessageFormRef} />
            </ResizablePanel>

            {isPanelOpen && (
                <Fragment key={activePanel}>
                    <ResizableHandle />

                    <ResizablePanel
                        id="right-panel"
                        order={2}
                        defaultSize={activePanel === 'artifact-preview' ? 35 : 20}
                        minSize={20}
                    >
                        {activePanel === 'artifact-preview' && <ArtifactPreviewPanel />}
                        {activePanel === 'artifacts' && <ArtifactsPanel onClose={closePanel} />}
                        {activePanel === 'resources' && <ResourcesPanel onClose={closePanel} />}
                    </ResizablePanel>
                </Fragment>
            )}
        </ResizablePanelGroup>
    );
}
