'use client';

import { useEffect, useRef } from 'react';
import { useChatContext } from '@/app/modules/chat/providers/chat-provider';
import { DashboardHeader } from '@/components/layouts/dashboard-layout/dashboard-header';
import ChatConversation from './chat-conversation/chat-conversation';
import ChatMessageForm from './chat-message-form';
import type { ChatMessageFormValues } from './chat-message-form/schema';

export default function ChatPanel() {
    const chatConversationRef = useRef<HTMLDivElement>(null);
    const chatMessageFormRef = useRef<HTMLFormElement>(null);

    const { state, sendMessage } = useChatContext();
    const { messages, isGenerating } = state;

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

    const handleSend = (data: ChatMessageFormValues) => {
        if (!data.message.trim()) return;
        sendMessage(data.message);
    };

    return (
        <div className="flex flex-col relative h-full">
            <DashboardHeader />

            <ChatConversation messages={messages} isLoading={isGenerating} ref={chatConversationRef} />

            <ChatMessageForm
                ref={chatMessageFormRef}
                onSubmit={handleSend}
                isLoading={isGenerating}
                className="absolute bottom-0 left-0 right-0"
            />
        </div>
    );
}
