'use client';

import { forwardRef, useImperativeHandle } from 'react';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import type { Message } from '../../chat-interface';
import { ChatEmptyState, type ChatEmptyStateProps } from './chat-empty-state';
import { ChatLoadingIndicator } from './chat-loading-indicator';
import { MessageBubble } from './message-bubble';

type ChatConversationProps = {
    messages: Message[];
    isLoading: boolean;
    emptyState?: ChatEmptyStateProps;
};

const ChatConversation = forwardRef<HTMLDivElement, ChatConversationProps>(
    ({ messages, isLoading, emptyState }, ref) => {
        const { containerRef } = useAutoScroll<HTMLDivElement>([messages, isLoading], {
            threshold: 100,
        });

        useImperativeHandle(ref, () => containerRef.current!, [containerRef]);

        return (
            <div ref={containerRef} className="relative flex-1 overflow-y-auto p-6">
                <div className="w-full max-w-4xl mx-auto space-y-4 min-w-0">
                    {messages.length === 0 && !isLoading && (
                        <div className="h-full flex items-center justify-center">
                            <ChatEmptyState {...emptyState} />
                        </div>
                    )}

                    {/* Render all messages */}
                    {messages.map((message) => (
                        <MessageBubble key={message.id} message={message} />
                    ))}

                    {/* Loading indicator when waiting for response */}
                    {isLoading && !messages.some((m) => m.isStreaming) && <ChatLoadingIndicator />}
                </div>
            </div>
        );
    },
);

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
