'use client';

import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { FileDropOverlay } from '@/modules/file-uploads/components/file-drop-overlay';
import { FileUploadProvider } from '@/modules/file-uploads/providers/file-upload-provider';
import ChatConversation from './chat-conversation/chat-conversation';
import { ChatEmptyTitle } from './chat-conversation/chat-empty-title';
import ChatMessageForm from './chat-message-form';
import { ContextWarningPill } from './context-warning-pill';

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
        <FileUploadProvider scope={{ projectId, chatId: chatId ?? undefined }} trackAsPending>
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
                <ChatConversation />
                <div className="relative z-10 -mt-6 shrink-0">
                    <div className="pointer-events-none absolute inset-x-0 bottom-full z-20">
                        <ContextWarningPill className="pointer-events-auto mb-3" />
                    </div>

                    <ChatMessageForm />
                </div>
            </div>
        </FileDropOverlay>
    );
}
