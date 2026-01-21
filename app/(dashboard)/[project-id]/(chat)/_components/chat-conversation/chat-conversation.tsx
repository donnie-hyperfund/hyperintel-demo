'use client';

import { forwardRef, useCallback, useEffect, useRef } from 'react';
import type { Message } from '../chat-interface';
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
        const scrollRef = useRef<HTMLDivElement>(null);
        const contentRef = useRef<HTMLDivElement>(null);
        const userScrolledRef = useRef(false);
        const lastScrollTop = useRef(0);

        const scrollToBottom = useCallback(() => {
            if (scrollRef.current && !userScrolledRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        }, []);

        // Handle scroll events - detect if user scrolled up
        const handleScroll = useCallback(() => {
            if (!scrollRef.current) return;
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

            // User scrolled up if scrollTop decreased and not at bottom
            if (scrollTop < lastScrollTop.current && !isAtBottom) {
                userScrolledRef.current = true;
            }
            // Reset if user scrolled back to bottom
            if (isAtBottom) {
                userScrolledRef.current = false;
            }
            lastScrollTop.current = scrollTop;
        }, []);

        // Scroll to bottom when messages change (if not user-scrolled)
        useEffect(() => {
            scrollToBottom();
        }, [messages, scrollToBottom]);

        // Scroll to bottom on initial load
        useEffect(() => {
            scrollToBottom();
        }, [scrollToBottom]);

        // Watch for content height changes (e.g., thinking blocks expanding)
        // and scroll to bottom if user was at bottom
        useEffect(() => {
            const contentEl = contentRef.current;
            const scrollEl = scrollRef.current;
            if (!contentEl || !scrollEl) return;

            const observer = new ResizeObserver(() => {
                // Check if we're at bottom before the resize caused content to grow
                const { scrollTop, scrollHeight, clientHeight } = scrollEl;
                const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;

                if (isAtBottom) {
                    scrollEl.scrollTop = scrollEl.scrollHeight;
                }
            });

            observer.observe(contentEl);
            return () => observer.disconnect();
        }, []);

        return (
            <div
                ref={(node) => {
                    scrollRef.current = node;
                    if (typeof ref === 'function') ref(node);
                    else if (ref) ref.current = node;
                }}
                className="flex-1 overflow-y-auto p-6"
                onScroll={handleScroll}
            >
                <div ref={contentRef} className="w-full max-w-4xl mx-auto space-y-4 min-w-0">
                    {messages.length === 0 && !isLoading && <ChatEmptyState {...emptyState} />}

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
