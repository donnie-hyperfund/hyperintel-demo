'use client';

import { cva } from 'class-variance-authority';
import { AnimatePresence, motion } from 'motion/react';
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

const messageContainerVariants = cva('w-full min-w-0 last:mb-0', {
    variants: {
        role: {
            user: 'mb-6',
            assistant: 'mb-14',
        },
    },
});

const ChatConversation = forwardRef<HTMLDivElement, ChatConversationProps>(
    ({ messages, isLoading, emptyState }, ref) => {
        const { containerRef } = useAutoScroll<HTMLDivElement>([messages, isLoading], {
            threshold: 100,
        });

        useImperativeHandle(ref, () => containerRef.current!, [containerRef]);

        return (
            <div ref={containerRef} className="relative flex-1 overflow-y-auto p-6">
                <div className="w-full max-w-4xl mx-auto min-w-0">
                    {messages.length === 0 && !isLoading && (
                        <div className="h-full flex items-center justify-center">
                            <ChatEmptyState {...emptyState} />
                        </div>
                    )}

                    {/* Render all messages with animations */}
                    <AnimatePresence initial={false}>
                        {messages.map((message, index) => (
                            <motion.div
                                key={message.id ?? index}
                                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                transition={{ duration: 0.3, ease: 'easeInOut' }}
                                className={messageContainerVariants({ role: message.role })}
                            >
                                <MessageBubble message={message} />
                            </motion.div>
                        ))}
                    </AnimatePresence>

                    {/* Loading indicator when waiting for response */}
                    {isLoading && !messages.some((m) => m.isStreaming) && <ChatLoadingIndicator />}
                </div>
            </div>
        );
    },
);

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
