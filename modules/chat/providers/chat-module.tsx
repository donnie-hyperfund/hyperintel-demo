'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, Suspense, useCallback } from 'react';
import { ModelSelectionProvider } from '@/modules/chat/providers/model-selection-provider';
import { ArtifactProvider } from '../../artifacts/providers/artifact-provider';
import type { Message } from '../types';
import { ActivePanelProvider } from './active-panel-provider';
import { ChatProvider } from './chat-provider';
import { ScrollTargetProvider } from './scroll-target-provider';

type ChatModuleBaseProps = {
    children: ReactNode;
    initialChatId?: string;
    initialMessages?: Message[];
    buildCreatedChatHref?: (chatId: string) => string;
};

type PhaseChatModuleProps = ChatModuleBaseProps & {
    chatType: 'phase';
    projectId: string;
};

type IntakeChatModuleProps = ChatModuleBaseProps & {
    chatType: 'company' | 'stakeholder';
    projectId?: never;
};

export type ChatModuleProps = PhaseChatModuleProps | IntakeChatModuleProps;

export function ChatModule({
    children,
    projectId,
    chatType,
    initialChatId,
    initialMessages = [],
    buildCreatedChatHref,
}: ChatModuleProps) {
    const router = useRouter();

    const buildChatRoute = useCallback(
        (nextChatId: string) => {
            if (buildCreatedChatHref) {
                return buildCreatedChatHref(nextChatId);
            }

            if (chatType === 'phase') {
                if (!projectId) throw new Error('Project ID is required for phase chats');
                return `/${projectId}/${nextChatId}`;
            }

            return `/${chatType === 'company' ? 'companies' : 'stakeholders'}/${nextChatId}`;
        },
        [buildCreatedChatHref, chatType, projectId],
    );

    const handleChatCreated = useCallback(
        (chatId: string) => {
            router.replace(buildChatRoute(chatId), { scroll: false });
        },
        [buildChatRoute, router],
    );

    return (
        <ActivePanelProvider>
            <ArtifactProvider>
                <ModelSelectionProvider projectId={projectId}>
                    <ChatProvider
                        projectId={projectId}
                        chatType={chatType}
                        initialChatId={initialChatId}
                        initialMessages={initialMessages}
                        onChatCreated={handleChatCreated}
                    >
                        <Suspense>
                            <ScrollTargetProvider>{children}</ScrollTargetProvider>
                        </Suspense>
                    </ChatProvider>
                </ModelSelectionProvider>
            </ArtifactProvider>
        </ActivePanelProvider>
    );
}
