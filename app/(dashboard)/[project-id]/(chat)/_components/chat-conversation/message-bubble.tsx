'use client';

import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import type { Message } from '../chat-interface';
import { DocumentCard } from './document-card';
import { parseDocumentDirectives, removeDocumentDirectives } from './document-directives';
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
    const displayText = removeDocumentDirectives(textContent);

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
                        <TypingIndicator />
                    </div>
                )}
            </div>
        </div>
    );
}
