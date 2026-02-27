'use client';

import { type DirectiveHandler, MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { convertBlocksToGlobalAnnotations } from '@/components/ui/markdown-renderer/citations';
import type { Message } from '@/modules/chat/types';
import { ArtifactIndicator } from '../../artifact-indicator';
import { TypingIndicator } from '../chat-conversation/typing-indicator';
import { MessageThinkingBlock } from './message-thinking-block';

type ChatMessageProps = {
    message: Message;
    renderMarkdown?: boolean;
};

const documentDirective: DirectiveHandler = ({ type, label, attributes, children }) => {
    const version = Number(attributes.version);

    if (type === 'container') {
        return (
            <div>
                <ArtifactIndicator
                    documentName={label}
                    documentVersion={version}
                    documentType={attributes['document-type']}
                />
                {children}
            </div>
        );
    }

    return (
        <ArtifactIndicator documentName={label} documentVersion={version} documentType={attributes['document-type']} />
    );
};

const chatDirectives = {
    document: documentDirective,
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
                            directives={chatDirectives}
                        />
                    ) : (
                        <p className="text-sm whitespace-pre-wrap">{textContent}</p>
                    ))}

                {isStreaming && blocks.length === 0 && <TypingIndicator />}

                {message.isError && (
                    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
                        Sorry, there was an error processing your request. Please try again.
                    </div>
                )}
            </div>
        </div>
    );
}
