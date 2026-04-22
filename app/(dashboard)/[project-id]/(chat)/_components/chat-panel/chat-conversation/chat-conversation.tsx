'use client';

import { cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef } from 'react';
import { TypingIndicator } from '@/app/(dashboard)/[project-id]/(chat)/_components/chat-panel/chat-conversation/typing-indicator';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { IS_DEV } from '@/lib/config';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useScrollTargetContext } from '@/modules/chat/providers/scroll-target-provider';
import { useFileUploadContext } from '@/modules/file-uploads/providers/file-upload-provider';
import { ChatMessage } from '../chat-message/chat-message';
import { SystemEventMessage } from '../chat-message/system-event-message';
import { ChatEmptyState, type ChatEmptyStateProps } from './chat-empty-state';

type ChatConversationProps = {
    emptyState?: ChatEmptyStateProps;
};

const messageContainerVariants = cva('w-full min-w-0', {
    variants: {
        role: {
            user: 'mb-6',
            assistant: 'mb-14',
            system: 'mb-6',
        },
    },
});

function ChatConversation({ emptyState }: ChatConversationProps) {
    const { state, pagination, loadMoreMessages } = useChatContext();
    const { messages, isGenerating, isLoading } = state;
    const { target: scrollTarget, foundRef: scrollTargetFoundRef } = useScrollTargetContext();
    const { files } = useFileUploadContext();

    // Deferred-send wait: uploads are being processed post-chat-migration before the POST fires.
    // The optimistic user message is intentionally deferred, so we render an info badge in its place.
    const isWaitingOnUploads = isGenerating && files.some((f) => f.status === 'processing');

    const { containerRef } = useAutoScroll<HTMLDivElement>([messages, isLoading], {
        threshold: 100,
    });

    // Track previous scroll height to maintain position after loading more
    const prevScrollHeightRef = useRef<number>(0);
    const isRestoringScrollRef = useRef(false);

    // Detect scroll to top and trigger loading more messages
    const handleScroll = useCallback(() => {
        if (scrollTarget) return;

        const container = containerRef.current;
        if (!container) return;

        // If near the top (within 100px) and there are more messages to load
        if (container.scrollTop < 100 && pagination.hasMore && !pagination.isLoadingMore) {
            // Save current scroll height before loading
            prevScrollHeightRef.current = container.scrollHeight;
            isRestoringScrollRef.current = true;
            loadMoreMessages();
        }
    }, [containerRef, pagination, loadMoreMessages, scrollTarget]);

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

    // Auto-load older messages until the scroll-target artifact is found.
    useEffect(() => {
        if (!scrollTarget || scrollTargetFoundRef.current) return;
        if (!pagination.hasMore || pagination.isLoadingMore || isLoading) return;

        loadMoreMessages();
    }, [scrollTarget, scrollTargetFoundRef, pagination.hasMore, pagination.isLoadingMore, isLoading, loadMoreMessages]);

    return (
        <div ref={containerRef} className="relative flex min-h-0 flex-1 overflow-y-auto py-6 px-4 lg:px-6">
            <div className="w-full max-w-3xl mx-auto min-w-0 min-h-full flex flex-col">
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
                    <div className="flex flex-1 items-center justify-center">
                        <ChatEmptyState {...emptyState} />
                    </div>
                )}

                {/* Render all messages with animations */}
                <AnimatePresence initial={false}>
                    {messages.map((message, index) => {
                        const role = message.systemEvent ? 'system' : message.role;
                        const isLastMessage = index === messages.length - 1;
                        return (
                            <motion.div
                                key={message.tempId ?? message.id ?? index}
                                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                transition={{ duration: 0.3, ease: 'easeInOut' }}
                                className={cn(messageContainerVariants({ role }), isLastMessage && 'mb-0')}
                            >
                                {message.systemEvent ? (
                                    <SystemEventMessage message={message} />
                                ) : (
                                    <ChatMessage message={message} />
                                )}
                            </motion.div>
                        );
                    })}
                </AnimatePresence>

                {/* User-side info badge shown during the pre-send upload wait. */}
                {isWaitingOnUploads && (
                    <div className="w-full min-w-0 mb-6">
                        <div className="max-w-[90%] min-w-0 ml-auto">
                            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2.5 text-sm text-blue-400/80 flex items-center gap-2">
                                <Loader2 className="size-4 animate-spin shrink-0" />
                                <span>Processing your uploads — your message will send shortly.</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Match the streaming assistant frame while waiting for the first token. */}
                {isGenerating && !isWaitingOnUploads && !messages.some((m) => m.isStreaming) && (
                    <div className="group max-w-[90%] min-w-0">
                        <div className="min-w-0 space-y-3">
                            <TypingIndicator />
                        </div>
                        {IS_DEV && <div aria-hidden className="mt-1 h-6" />}
                    </div>
                )}

                {/* Preserve a safe scroll tail above the overlapping composer after removing the old JS bottom-padding hack. */}
                {(messages.length > 0 || isGenerating) && <div aria-hidden className="h-12 shrink-0" />}
            </div>
        </div>
    );
}

export default ChatConversation;
