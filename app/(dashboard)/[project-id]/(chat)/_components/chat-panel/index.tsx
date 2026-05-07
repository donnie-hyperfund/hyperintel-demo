'use client';

import { AnimatePresence } from 'motion/react';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { DevSlot } from '@/lib/dev-slots';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { FileDropOverlay } from '@/modules/file-uploads/components/file-drop-overlay';
import { FileUploadProvider } from '@/modules/file-uploads/providers/file-upload-provider';
import { ScrollToBottomButton } from '../scroll-to-bottom-button';
import ChatConversation from './chat-conversation/chat-conversation';
import { ChatEmptyTitle } from './chat-conversation/chat-empty-title';
import ChatMessageForm from './chat-message-form';
import { ContextUsageIndicator } from './context-usage-indicator';
import { DecisionPrompt } from './decision-prompt';
import { PhaseTransitionController } from './phase-transition-controller';
import { ChatStatusPill } from './status-pill';

type ChatPanelProps = {
    HeaderComponent: React.ReactNode;
    emptyTitle: string;
    emptySubtitle: string;
};

export default function ChatPanel({ HeaderComponent, emptyTitle, emptySubtitle }: ChatPanelProps) {
    const { chatId, chatType, projectId } = useChatContext();
    const isEmpty = !chatId;
    const allowUploadBeforeFirstMessage = chatType !== 'phase';

    return (
        <FileUploadProvider scope={{ kind: 'chat-input', chatType, projectId, chatId: chatId ?? undefined }}>
            <ChatPanelContent
                isEmpty={isEmpty}
                allowUploadBeforeFirstMessage={allowUploadBeforeFirstMessage}
                HeaderComponent={HeaderComponent}
                emptyTitle={emptyTitle}
                emptySubtitle={emptySubtitle}
            />
        </FileUploadProvider>
    );
}

function ChatPanelContent({
    isEmpty,
    allowUploadBeforeFirstMessage,
    HeaderComponent,
    emptyTitle,
    emptySubtitle,
}: ChatPanelProps & {
    isEmpty: boolean;
    allowUploadBeforeFirstMessage: boolean;
}) {
    const {
        chatType,
        pendingDecisions,
        state: { messages, tokenUsage, isLoading },
    } = useChatContext();
    const isPhaseChat = chatType === 'phase';
    const hasPendingDecision = pendingDecisions.length > 0;

    const { containerRef, isAtBottom, scrollToBottom } = useAutoScroll<HTMLDivElement>([messages, isLoading], {
        threshold: 100,
    });
    const showScrollToBottom = !isAtBottom && messages.length > 0;

    if (isEmpty) {
        const content = (
            <>
                {HeaderComponent}

                <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
                    <ChatEmptyTitle title={emptyTitle} subtitle={emptySubtitle} className="mb-12 px-4" />
                    <ChatMessageForm className="w-full shrink-0" showGradientFade={false} />
                </div>
            </>
        );

        if (allowUploadBeforeFirstMessage) {
            return <FileDropOverlay className="relative flex h-full min-h-0 flex-col">{content}</FileDropOverlay>;
        }

        return <div className="relative flex h-full min-h-0 flex-col">{content}</div>;
    }

    return (
        <FileDropOverlay className="relative flex h-full min-h-0 flex-col">
            {HeaderComponent}

            <div className="flex min-h-0 flex-1 flex-col">
                <ChatConversation containerRef={containerRef} />
                <div className="relative z-10 -mt-6 shrink-0">
                    <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 flex flex-col items-center gap-3 pb-3">
                        <AnimatePresence>
                            {showScrollToBottom && (
                                <ScrollToBottomButton
                                    key="chat-scroll-to-bottom"
                                    onClick={() => scrollToBottom()}
                                    className="pointer-events-auto"
                                />
                            )}
                        </AnimatePresence>
                        <ChatStatusPill className="pointer-events-auto" />
                    </div>
                    {hasPendingDecision && <DecisionPrompt />}
                    {/* Hidden, not unmounted — prevents the form's motion entrance from re-firing on every decision resolve. */}
                    <div className={cn(hasPendingDecision && 'hidden')}>
                        <ChatMessageForm />
                    </div>

                    <div className="px-4">
                        <div className="mx-auto flex h-9 w-full max-w-3xl items-center px-1">
                            <DevSlot name="chat-footer" />
                            <ContextUsageIndicator tokenUsage={tokenUsage} className="ml-auto" />
                        </div>
                    </div>
                </div>
            </div>

            {isPhaseChat && <PhaseTransitionController />}
        </FileDropOverlay>
    );
}
