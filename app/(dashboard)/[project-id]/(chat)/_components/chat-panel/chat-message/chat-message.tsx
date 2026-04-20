'use client';

import { memo } from 'react';
import { ErrorReferenceList } from '@/components/ui/error-reference-list';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { convertBlocksToGlobalAnnotations } from '@/components/ui/markdown-renderer/citations';
import { DevSlot } from '@/lib/dev-slots';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import type { Message } from '@/modules/chat/types';
import { TypingIndicator } from '../chat-conversation/typing-indicator';
import { ActiveInternalDocs } from './active-internal-docs';
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
    const { chatId } = useChatContext();
    const { blocks, role, isStreaming } = message;
    const errorReferenceItems = [
        { label: 'Request ID', value: message.metadata?.requestId },
        { label: 'Error Code', value: message.metadata?.errorCode },
    ];
    const visibleErrorReferenceItems = errorReferenceItems.filter((item) => !!item.value?.trim());
    const hasRequestId = !!message.metadata?.requestId?.trim();
    const errorTracingHint = hasRequestId
        ? 'Copy the request ID if you need help tracing this failure.'
        : visibleErrorReferenceItems.length > 0
          ? 'Copy the reference below if you need help tracing this failure.'
          : 'This older error does not include trace identifiers.';

    if (role === 'user') {
        const text = blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.content)
            .join('\n');
        return (
            <div className="group max-w-[90%] min-w-0 justify-self-end">
                <div className="rounded-4 py-3 px-4 bg-neutral-800 text-foreground">
                    <div className="min-w-0">
                        {renderMarkdown ? (
                            <MarkdownRenderer markdown={text} variant="message" directives={chatDirectives} />
                        ) : (
                            <p className="text-sm whitespace-pre-wrap">{text}</p>
                        )}
                    </div>
                </div>
                <div className="flex justify-end">
                    {/* biome-ignore lint/a11y/useValidAriaRole: `role` is a DevSlot prop, not an ARIA role */}
                    <DevSlot
                        name="message-actions"
                        chatId={chatId}
                        messageId={message.id}
                        content={text}
                        role="user"
                        blocks={blocks}
                        feedbackScore={message.feedbackScore}
                        feedbackComment={message.feedbackComment}
                        metadata={message.metadata}
                    />
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
        <div className="group max-w-[90%] min-w-0">
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

                {isStreaming && <ActiveInternalDocs />}

                {message.isError && (
                    <div className="mt-3 rounded-2xl border border-red-500/22 bg-red-500/[0.08] p-4">
                        <div className="space-y-2">
                            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-red-200/72">
                                Request Failed
                            </p>
                            <p className="text-sm font-medium text-red-100">
                                {message.metadata?.error ?? 'We could not complete this request.'}
                            </p>
                            <p className="text-sm leading-6 text-red-100/68">{errorTracingHint}</p>
                        </div>
                        <ErrorReferenceList className="mt-3" items={errorReferenceItems} variant="compact" />
                    </div>
                )}

                {message.isAborted && (
                    <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2.5 text-sm text-blue-400/80">
                        This response was stopped by the user.
                    </div>
                )}
            </div>
            {/* biome-ignore lint/a11y/useValidAriaRole: `role` is a DevSlot prop, not an ARIA role */}
            <DevSlot
                name="message-actions"
                chatId={chatId}
                messageId={message.id}
                content={textContent}
                role="assistant"
                blocks={blocks}
                feedbackScore={message.feedbackScore}
                feedbackComment={message.feedbackComment}
                metadata={message.metadata}
            />
        </div>
    );
});

ChatMessage.displayName = 'ChatMessage';
