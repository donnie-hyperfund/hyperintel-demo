'use client';

import { useEffect, useRef } from 'react';
import { DashboardHeader } from '@/components/layouts/dashboard-layout/dashboard-header';
import type { PaginationState } from '@/modules/chat/types';
import type { Message } from '../chat-interface';
import ChatConversation from './chat-conversation/chat-conversation';
import ChatMessageForm from './chat-message-form';

type ChatPanelProps = {
    messages: Message[];
    isGenerating: boolean;
    isLoading: boolean;
    onLoadMore?: () => void;
    pagination?: PaginationState;
    conversationRef?: React.RefObject<HTMLDivElement | null>;
    formRef?: React.RefObject<HTMLDivElement | null>;
};

export default function ChatPanel({
    messages,
    isGenerating,
    isLoading,
    onLoadMore,
    pagination,
    conversationRef,
    formRef,
}: ChatPanelProps) {
    const internalConversationRef = useRef<HTMLDivElement>(null);
    const internalFormRef = useRef<HTMLDivElement>(null);

    const chatConversationRef = conversationRef ?? internalConversationRef;
    const chatMessageFormRef = formRef ?? internalFormRef;

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
    }, [chatConversationRef, chatMessageFormRef]);

    return (
        <div className="flex flex-col relative h-full">
            <DashboardHeader />

            <ChatConversation
                messages={messages}
                isGenerating={isGenerating}
                isLoading={isLoading}
                onLoadMore={onLoadMore}
                pagination={pagination}
                ref={chatConversationRef}
            />

            <ChatMessageForm ref={chatMessageFormRef} className="absolute bottom-0 left-0 right-0" />
        </div>
    );
}
