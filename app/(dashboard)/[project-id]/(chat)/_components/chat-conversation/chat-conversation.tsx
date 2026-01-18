'use client';

import { Brain, ChevronDown, ChevronRight, Layers, Loader2, Wrench } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import type { StreamBlock } from '@/common/ai/agent/types';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import type { Message } from '../chat-interface';

// Document directive regex for parsing embedded document references
const DIRECTIVE_REGEX = /::document\[([^\]]+)\]\{([^}]+)\}/g;

function parseDocumentDirectives(text: string) {
    const docs: { name: string; version?: number; action?: string; lines?: number }[] = [];
    let match;
    while ((match = DIRECTIVE_REGEX.exec(text)) !== null) {
        const name = match[1];
        const attrs = Object.fromEntries(
            match[2].split(' ').map((p) => {
                const [k, v] = p.split('=');
                return [k, isNaN(+v) ? v : +v];
            }),
        );
        docs.push({ name, ...attrs });
    }
    return docs;
}

// Collapsible thinking section showing reasoning and tool calls
function ThinkingSection({
    blocks,
    defaultExpanded,
    isStreaming,
    status,
}: {
    blocks: StreamBlock[];
    defaultExpanded: boolean;
    isStreaming?: boolean;
    status?: string;
}) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [shouldAnimate, setShouldAnimate] = useState(false);
    const wasStreaming = useRef(isStreaming);
    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-expand when defaultExpanded changes (streaming starts)
    useEffect(() => {
        if (defaultExpanded) setExpanded(true);
    }, [defaultExpanded]);

    // Auto-scroll content to bottom during streaming
    useEffect(() => {
        const container = contentRef.current;
        if (!container || !isStreaming) return;
        container.scrollTop = container.scrollHeight;
    }, [blocks, isStreaming]);

    // Auto-collapse with animation when streaming ends
    useEffect(() => {
        if (wasStreaming.current && !isStreaming) {
            // Streaming just ended - collapse with animation
            setShouldAnimate(true);
            // Small delay to let animation style apply before collapsing
            setTimeout(() => setExpanded(false), 50);
            // Clear animation flag after transition completes
            setTimeout(() => setShouldAnimate(false), 350);
        }
        wasStreaming.current = isStreaming;
    }, [isStreaming]);

    const handleToggle = () => {
        // Manual toggle - no animation
        setShouldAnimate(false);
        setExpanded((prev) => !prev);
    };

    const handleClick = (e: React.MouseEvent) => {
        // Don't toggle if user selected text
        if (window.getSelection()?.toString()) return;
        // Don't toggle if user clicked an interactive element
        if ((e.target as HTMLElement).closest('a, button')) return;
        handleToggle();
    };

    const toolCount = blocks.filter((b) => b.type === 'tool_call').length;
    const defaultLabel = toolCount > 0 ? `Thinking + ${toolCount} action${toolCount > 1 ? 's' : ''}` : 'Thinking';
    // Use status from backend while streaming, otherwise use default
    const label = isStreaming && status ? status : defaultLabel;

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: visual toggle, not critical interaction
        <div
            className="mb-2 ring-1 ring-border/50 rounded-lg overflow-hidden bg-muted/30 hover:bg-muted/50 cursor-pointer"
            onClick={handleClick}
        >
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span className="font-medium">{label}</span>
            </div>

            <div
                ref={contentRef}
                className={`overflow-hidden ${shouldAnimate ? 'transition-all duration-300 ease-out' : ''}`}
                style={{
                    maxHeight: expanded ? '1000px' : '0',
                    opacity: expanded ? 1 : 0,
                }}
            >
                <div
                    ref={contentRef}
                    className={`px-3 pb-3 space-y-2 overflow-y-auto ${isStreaming ? 'max-h-32' : 'max-h-48'}`}
                >
                    {blocks.map((block) =>
                        block.type === 'reasoning' ? (
                            <ReasoningBubble key={block.id} content={block.content || ''} />
                        ) : (
                            <ToolCallBadge
                                key={block.id}
                                tool={(block as any).toolName}
                                result={(block as any).toolResult}
                                success={(block as any).toolSuccess}
                            />
                        ),
                    )}
                </div>
            </div>
        </div>
    );
}

function ReasoningBubble({ content }: { content: string }) {
    if (!content.trim()) return null;

    return (
        <div className="flex gap-2 items-start">
            <Brain className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground/80 whitespace-pre-wrap">{content}</div>
        </div>
    );
}

function ToolCallBadge({ tool, result, success }: { tool: string; result?: any; success?: boolean }) {
    const statusIcon = success === undefined ? '⏳' : success ? '✓' : '✗';
    const statusColor = success === undefined ? 'text-yellow-500' : success ? 'text-green-500' : 'text-red-500';

    return (
        <div className="flex gap-2 items-center">
            <Wrench className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{tool}</span>
            <span className={`text-sm ${statusColor}`}>{statusIcon}</span>
        </div>
    );
}

function DocumentCard({ name, version, action }: { name: string; version?: number; action?: string }) {
    const icon = action === 'created' ? '📄' : action === 'replaced' ? '📝' : '✏️';

    return (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg text-sm mt-2">
            <span>{icon}</span>
            <span className="font-medium">{name}</span>
            {version && <span className="text-muted-foreground">v{version}</span>}
        </div>
    );
}

// Render a single message from its blocks
function MessageBubble({ message, renderMarkdown = true }: { message: Message; renderMarkdown?: boolean }) {
    const { blocks, role, isStreaming } = message;

    if (role === 'user') {
        // User message: just show text content
        const text = blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.content)
            .join('\n');
        return (
            <div className="flex gap-3 justify-end">
                <div className="max-w-[80%] rounded-lg px-4 py-2 bg-primary text-primary-foreground">
                    {renderMarkdown ? (
                        <MarkdownRenderer markdown={text} variant="message" />
                    ) : (
                        <p className="text-sm whitespace-pre-wrap">{text}</p>
                    )}
                </div>
            </div>
        );
    }

    // Assistant message: show thinking section + text + document cards
    const thinkingBlocks = blocks.filter((b) => b.type === 'reasoning' || b.type === 'tool_call');
    const textBlocks = blocks.filter((b) => b.type === 'text');
    const textContent = textBlocks.map((b) => b.content).join('\n');
    const documents = parseDocumentDirectives(textContent);

    // Remove document directives from display text
    const displayText = textContent.replace(DIRECTIVE_REGEX, '').trim();

    return (
        <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                <span className="text-xs text-primary-foreground font-bold">AI</span>
            </div>
            <div className="max-w-[80%] space-y-2">
                {/* Collapsible thinking section */}
                {thinkingBlocks.length > 0 && (
                    <ThinkingSection
                        blocks={thinkingBlocks}
                        defaultExpanded={!!isStreaming}
                        isStreaming={isStreaming}
                        status={message.status}
                    />
                )}

                {/* Main text content */}
                {displayText && (
                    <div className="rounded-lg px-4 py-2 bg-muted">
                        {renderMarkdown ? (
                            <MarkdownRenderer markdown={displayText} variant="message" />
                        ) : (
                            <p className="text-sm whitespace-pre-wrap">{displayText}</p>
                        )}
                    </div>
                )}

                {/* Document cards */}
                {documents.map((doc) => (
                    <DocumentCard key={doc.name} {...doc} />
                ))}

                {/* Show typing indicator if streaming with no content yet */}
                {isStreaming && blocks.length === 0 && (
                    <div className="rounded-lg px-4 py-2 bg-muted">
                        <div className="flex gap-1">
                            <span
                                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                style={{ animationDelay: '0ms' }}
                            />
                            <span
                                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                style={{ animationDelay: '150ms' }}
                            />
                            <span
                                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                style={{ animationDelay: '300ms' }}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

type ChatConversationProps = {
    messages: Message[];
    isLoading: boolean;
    emptyState?: {
        icon?: React.ReactNode;
        title?: string;
        description?: string;
    };
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
                    {messages.length === 0 && !isLoading && (
                        <div className="h-full flex items-center justify-center">
                            {emptyState ? (
                                <div className="text-center space-y-3 max-w-sm">
                                    {emptyState.icon || (
                                        <div className="w-16 h-16 mx-auto bg-muted rounded-lg flex items-center justify-center">
                                            <Layers className="w-8 h-8 text-muted-foreground/50" />
                                        </div>
                                    )}
                                    <div className="space-y-1">
                                        <p className="text-lg font-medium text-foreground">
                                            {emptyState.title || 'Artifact Preview'}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {emptyState.description || 'Generated artifacts will appear here'}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center space-y-2">
                                    <div className="text-4xl">💬</div>
                                    <p className="text-muted-foreground">Start a conversation</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Render all messages */}
                    {messages.map((message) => (
                        <MessageBubble key={message.id} message={message} />
                    ))}

                    {/* Loading indicator when waiting for response */}
                    {isLoading && !messages.some((m) => m.isStreaming) && (
                        <div className="flex gap-3 justify-start">
                            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                                <Loader2 className="w-4 h-4 text-primary-foreground animate-spin" />
                            </div>
                            <div className="max-w-[80%] rounded-lg px-4 py-2 text-sm bg-muted">
                                <div className="flex gap-1">
                                    <span
                                        className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                        style={{ animationDelay: '0ms' }}
                                    />
                                    <span
                                        className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                        style={{ animationDelay: '150ms' }}
                                    />
                                    <span
                                        className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                        style={{ animationDelay: '300ms' }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    },
);

ChatConversation.displayName = 'ChatConversation';

export default ChatConversation;
