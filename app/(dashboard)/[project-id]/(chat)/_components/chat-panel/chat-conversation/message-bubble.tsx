'use client';

import { MarkdownRenderer, type DirectiveHandler } from '@/components/ui/markdown-renderer';
import { convertBlocksToGlobalAnnotations } from '@/components/ui/markdown-renderer/citations';
import { ArtifactIndicator } from '../../artifact-indicator';
import type { Message } from '../../chat-interface';
import { ThinkingSection } from './thinking-section';
import { TypingIndicator } from './typing-indicator';

type MessageBubbleProps = {
    message: Message;
    renderMarkdown?: boolean;
};

const documentDirective: DirectiveHandler = ({ type, name, label, attributes, children }) => {
    if (type === 'container') {
        return (
            <div>
                <ArtifactIndicator
                    documentName={label}
                    documentVersion={attributes.version}
                    documentAction={attributes.action}
                />
                {children}
            </div>
        );
    }

    return (
        <ArtifactIndicator
            documentName={label}
            documentVersion={attributes.version}
            documentAction={attributes.action}
        />
    );
};

export function MessageBubble({ message, renderMarkdown = true }: MessageBubbleProps) {
    const { blocks, role, isStreaming } = message;

    if (role === 'user') {
        // User message: just show text content
        const text = blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.content)
            .join('\n');
        return (
            <div className="flex gap-3 justify-end">
                <div className="max-w-[80%] overflow-hidden rounded-lg px-4 py-2 bg-primary text-primary-foreground">
                    {renderMarkdown ? (
                        <MarkdownRenderer markdown={text} variant="message" />
                    ) : (
                        <p className="text-sm whitespace-pre-wrap">{text}</p>
                    )}
                </div>
            </div>
        );
    }

    // Assistant message: show thinking section + text/documents inline
    const thinkingBlocks = blocks.filter((b) => b.type === 'reasoning' || b.type === 'tool_call');
    const textBlocks = blocks.filter((b) => b.type === 'text');

    // Convert block-local citations to global positions across concatenated text
    const { fullText: textContent, citations } = convertBlocksToGlobalAnnotations(blocks, '\n');

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

                {/* Inline content: text and document cards rendered via markdown */}
                {textContent && (
                    <div className="overflow-hidden rounded-lg px-4 py-2 bg-muted">
                        {renderMarkdown ? (
                            <MarkdownRenderer
                                markdown={textContent}
                                variant="message"
                                citations={citations.length > 0 ? citations : undefined}
                                directives={{
                                    document: documentDirective,
                                }}
                            />
                        ) : (
                            <p className="text-sm whitespace-pre-wrap">{textContent}</p>
                        )}
                    </div>
                )}

                {/* Show typing indicator if streaming with no content yet */}
                {isStreaming && blocks.length === 0 && (
                    <div className="rounded-lg px-4 py-2 bg-muted">
                        <TypingIndicator />
                    </div>
                )}
            </div>
        </div>
    );
}
