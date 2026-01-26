'use client';

import { cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import type { PaginationState } from '@/modules/chat/types';
import type { Message } from '../../chat-interface';
import { ChatEmptyState, type ChatEmptyStateProps } from './chat-empty-state';
import { ChatLoadingIndicator } from './chat-loading-indicator';
import { MessageBubble } from './message-bubble';

type ChatConversationProps = {
    messages: Message[];
    isGenerating: boolean;
    isLoading: boolean;
    emptyState?: ChatEmptyStateProps;
    onLoadMore?: () => void;
    pagination?: PaginationState;
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
    ({ messages, isGenerating, isLoading, emptyState, onLoadMore, pagination }, ref) => {
        const { containerRef } = useAutoScroll<HTMLDivElement>([messages, isLoading], {
            threshold: 100,
        });

        // Track previous scroll height to maintain position after loading more
        const prevScrollHeightRef = useRef<number>(0);
        const isRestoringScrollRef = useRef(false);

        useImperativeHandle(ref, () => containerRef.current!, [containerRef]);

        // Detect scroll to top and trigger loading more messages
        const handleScroll = useCallback(() => {
            const container = containerRef.current;
            if (!container || !onLoadMore || !pagination) return;

            // If near the top (within 100px) and there are more messages to load
            if (container.scrollTop < 100 && pagination.hasMore && !pagination.isLoadingMore) {
                // Save current scroll height before loading
                prevScrollHeightRef.current = container.scrollHeight;
                isRestoringScrollRef.current = true;
                onLoadMore();
            }
        }, [containerRef, onLoadMore, pagination]);

        // Restore scroll position after loading more messages
        useEffect(() => {
            const container = containerRef.current;
            if (!container || !isRestoringScrollRef.current) return;

            if (!pagination?.isLoadingMore && prevScrollHeightRef.current > 0) {
                // Calculate how much content was added and scroll to maintain position
                const newScrollHeight = container.scrollHeight;
                const scrollDiff = newScrollHeight - prevScrollHeightRef.current;
                container.scrollTop = scrollDiff;

                prevScrollHeightRef.current = 0;
                isRestoringScrollRef.current = false;
            }
        }, [containerRef, pagination?.isLoadingMore, messages.length]);

        // Attach scroll listener
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            container.addEventListener('scroll', handleScroll);
            return () => container.removeEventListener('scroll', handleScroll);
        }, [containerRef, handleScroll]);

        return (
            <div ref={containerRef} className="relative flex-1 overflow-y-auto p-6">
                <div className="w-full max-w-4xl mx-auto min-w-0 min-h-full flex flex-col">
                    {/* Loading indicator for older messages */}
                    {pagination?.isLoadingMore && (
                        <div className="flex justify-center py-4">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    )}

                    {isLoading && (
                        <div className="flex flex-1 justify-center items-center">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    )}

                    {messages.length === 0 && !isGenerating && !isLoading && (
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
                    {isGenerating && !messages.some((m) => m.isStreaming) && <ChatLoadingIndicator />}
                </div>
            </div>
        );
    },
);

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
