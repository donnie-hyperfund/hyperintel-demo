'use client';

import { memo } from 'react';
import { type DirectiveHandler, MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { convertBlocksToGlobalAnnotations } from '@/components/ui/markdown-renderer/citations';
import type { Message } from '@/modules/chat/types';
import { TypingIndicator } from '../chat-conversation/typing-indicator';
import { DocumentDirective } from './document-directive';
import { UploadDirective } from './file-directive';
import { MessageThinkingBlock } from './message-thinking-block';

type ChatMessageProps = {
    message: Message;
    renderMarkdown?: boolean;
};

const chatDirectives = {
    document: DocumentDirective,
    upload: UploadDirective,
};

export const ChatMessage = memo(({ message, renderMarkdown = true }: ChatMessageProps) => {
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
                        <MarkdownRenderer markdown={text} variant="message" directives={chatDirectives} />
                    ) : (
                        <p className="text-sm whitespace-pre-wrap">{text}</p>
                    )}
                </div>
            </div>
        );
    }

    if (message.isRetracted) {
        return (
            <div className="max-w-[90%] min-w-0">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-400">
                    Response removed for safety reasons.
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

                {isStreaming && !textContent && thinkingBlocks.length === 0 && <TypingIndicator />}

                {message.isError && (
                    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
                        Sorry, there was an error processing your request. Please try again.
                    </div>
                )}

                {message.isAborted && (
                    <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2.5 text-sm text-blue-400/80">
                        This response was stopped by the user.
                    </div>
                )}
            </div>
        </div>
    );
});

ChatMessage.displayName = 'ChatMessage';
