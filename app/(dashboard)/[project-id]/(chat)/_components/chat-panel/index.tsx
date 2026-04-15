'use client';

import { useEffect, useRef } from 'react';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { FileDropOverlay } from '@/modules/file-uploads/components/file-drop-overlay';
import { FileUploadProvider } from '@/modules/file-uploads/providers/file-upload-provider';
import ChatConversation from './chat-conversation/chat-conversation';
import { ChatEmptyTitle } from './chat-conversation/chat-empty-title';
import ChatMessageForm from './chat-message-form';

type ChatPanelProps = {
    HeaderComponent: React.ReactNode;
    emptyTitle: string;
    emptySubtitle: string;
};

export default function ChatPanel({ HeaderComponent, emptyTitle, emptySubtitle }: ChatPanelProps) {
    const { chatId, chatType, projectId } = useChatContext();
    const isEmpty = !chatId;
    const allowUploadBeforeFirstMessage = chatType !== 'phase';

    const conversationRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isEmpty) return;

        const formElement = formRef.current;
        const conversationElement = conversationRef.current;

        if (!formElement || !conversationElement) return;

        const updatePadding = () => {
            const height = formElement.offsetHeight;
            conversationElement.style.paddingBottom = `${height + 16}px`;
        };

        updatePadding();

        const resizeObserver = new ResizeObserver(updatePadding);
        resizeObserver.observe(formElement);

        return () => {
            resizeObserver.disconnect();
        };
    }, [isEmpty]);

    return (
        <FileUploadProvider scope={{ projectId, chatId: chatId ?? undefined }} trackAsPending>
            <ChatPanelContent
                isEmpty={isEmpty}
                allowUploadBeforeFirstMessage={allowUploadBeforeFirstMessage}
                HeaderComponent={HeaderComponent}
                emptyTitle={emptyTitle}
                emptySubtitle={emptySubtitle}
                conversationRef={conversationRef}
                formRef={formRef}
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
    conversationRef,
    formRef,
}: ChatPanelProps & {
    isEmpty: boolean;
    allowUploadBeforeFirstMessage: boolean;
    conversationRef: React.RefObject<HTMLDivElement | null>;
    formRef: React.RefObject<HTMLDivElement | null>;
}) {
    if (isEmpty) {
        const content = (
            <>
                {HeaderComponent}

                <div className="flex flex-1 flex-col items-center justify-center">
                    <ChatEmptyTitle title={emptyTitle} subtitle={emptySubtitle} className="mb-12 px-4" />
                    <ChatMessageForm ref={formRef} className="w-full" showGradientFade={false} />
                </div>
            </>
        );

        if (allowUploadBeforeFirstMessage) {
            return <FileDropOverlay className="flex flex-col relative h-full">{content}</FileDropOverlay>;
        }

        return <div className="flex flex-col relative h-full">{content}</div>;
    }

    return (
        <FileDropOverlay className="flex flex-col relative h-full">
            {HeaderComponent}

            <ChatConversation ref={conversationRef} />

            <div className="absolute bottom-0 left-0 right-0">
                <ChatMessageForm ref={formRef} />
            </div>
        </FileDropOverlay>
    );
}
