'use client';

import { useEffect, useRef } from 'react';
import { DashboardHeader } from '@/components/layouts/dashboard-layout/dashboard-header';
import type { Message } from '../chat-interface';
import ChatConversation from './chat-conversation/chat-conversation';
import ChatMessageForm from './chat-message-form';
import type { ChatMessageFormValues } from './chat-message-form/schema';

type ChatPanelProps = {
    messages: Message[];
    isLoading: boolean;
    onSend: (data: ChatMessageFormValues) => void;
    conversationRef?: React.RefObject<HTMLDivElement | null>;
    formRef?: React.RefObject<HTMLFormElement | null>;
};

export default function ChatPanel({ messages, isLoading, onSend, conversationRef, formRef }: ChatPanelProps) {
    const internalConversationRef = useRef<HTMLDivElement>(null);
    const internalFormRef = useRef<HTMLFormElement>(null);

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

    const handleSend = (data: ChatMessageFormValues) => {
        if (!data.message.trim()) return;
        onSend(data);
    };

    return (
        <div className="flex flex-col relative h-full">
            <DashboardHeader />

            <ChatConversation messages={messages} isLoading={isLoading} ref={chatConversationRef} />

            <ChatMessageForm
                ref={chatMessageFormRef}
                onSubmit={handleSend}
                isLoading={isLoading}
                className="absolute bottom-0 left-0 right-0"
            />
        </div>
    );
}
