'use client';

import { useEffect, useRef } from 'react';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import ChatConversation from './chat-conversation/chat-conversation';
import { ChatEmptyTitle } from './chat-conversation/chat-empty-title';
import ChatMessageForm from './chat-message-form';

type ChatPanelProps = {
    HeaderComponent: React.ReactNode;
    emptyTitle: string;
    emptySubtitle: string;
};

export default function ChatPanel({ HeaderComponent, emptyTitle, emptySubtitle }: ChatPanelProps) {
    const { chatId } = useChatContext();
    const isEmpty = !chatId;

    const conversationRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isEmpty) return;

        const formElement = formRef.current;
        const conversationElement = conversationRef.current;

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
    }, [isEmpty]);

    if (isEmpty) {
        return (
            <div className="flex flex-col relative h-full">
                {HeaderComponent}

                <div className="flex flex-1 flex-col items-center justify-center px-4">
                    <ChatEmptyTitle title={emptyTitle} subtitle={emptySubtitle} className="mb-12" />
                    <ChatMessageForm ref={formRef} className="w-full" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col relative h-full">
            {HeaderComponent}

            <ChatConversation ref={conversationRef} />

            <div className="absolute bottom-0 left-0 right-0">
                <ChatMessageForm ref={formRef} />
            </div>
        </div>
    );
}
