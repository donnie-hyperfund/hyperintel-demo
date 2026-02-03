'use client';

import { type DirectiveHandler, MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { convertBlocksToGlobalAnnotations } from '@/components/ui/markdown-renderer/citations';
import { ArtifactIndicator } from '../../artifact-indicator';
import type { Message } from '../../chat-interface';
import { TypingIndicator } from '../chat-conversation/typing-indicator';
import { MessageThinkingBlock } from './message-thinking-block';

type ChatMessageProps = {
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

export function ChatMessage({ message, renderMarkdown = true }: ChatMessageProps) {
    const { blocks, role, isStreaming } = message;

    if (role === 'user') {
        const text = blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.content)
            .join('\n');
        return (
            <div className="max-w-[90%] min-w-0 rounded-4 py-3 px-4 bg-neutral-800 text-foreground justify-self-end">
                <div className="min-w-0">
                    {renderMarkdown ? (
                        <MarkdownRenderer markdown={text} variant="message" />
                    ) : (
                        <p className="text-sm whitespace-pre-wrap">{text}</p>
                    )}
                </div>
            </div>
        );
    }

    const thinkingBlocks = blocks.filter((b) => b.type === 'reasoning' || b.type === 'tool_call');
    const { fullText: textContent, citations } = convertBlocksToGlobalAnnotations(blocks, '\n');

    return (
        <div className="max-w-[90%] min-w-0">
            <div className="min-w-0 space-y-3">
                {thinkingBlocks.length > 0 && (
                    <MessageThinkingBlock
                        blocks={thinkingBlocks}
                        defaultExpanded={!!isStreaming}
                        isStreaming={isStreaming}
                        status={message.status}
                    />
                )}

                {textContent &&
                    (renderMarkdown ? (
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
                    ))}

                {isStreaming && blocks.length === 0 && <TypingIndicator />}
            </div>
        </div>
    );
}
