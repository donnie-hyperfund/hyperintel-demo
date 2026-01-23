'use client';

import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { ArtifactIndicator } from '../../artifact-indicator';
import type { Message } from '../../chat-interface';
import { splitByDocumentDirectives } from './document-directives';
import { ThinkingSection } from './thinking-section';
import { TypingIndicator } from './typing-indicator';

type MessageBubbleProps = {
    message: Message;
    renderMarkdown?: boolean;
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
    const textContent = textBlocks.map((b) => b.content).join('\n');

    // Split content into inline segments (text and documents in order)
    const segments = splitByDocumentDirectives(textContent);

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

                {/* Inline content: text and document cards in order */}
                {segments.map((segment, index) => {
                    if (segment.type === 'text') {
                        return (
                            <div key={`text-${index}`} className="overflow-hidden rounded-lg px-4 py-2 bg-muted">
                                {renderMarkdown ? (
                                    <MarkdownRenderer markdown={segment.content} variant="message" />
                                ) : (
                                    <p className="text-sm whitespace-pre-wrap">{segment.content}</p>
                                )}
                            </div>
                        );
                    }
                    // Document indicator
                    const doc = segment.directive;
                    return (
                        <ArtifactIndicator
                            key={`doc-${index}-${doc.name}-${doc.version ?? 0}`}
                            documentName={doc.name}
                            documentVersion={doc.version}
                            documentAction={doc.action}
                        />
                    );
                })}

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
