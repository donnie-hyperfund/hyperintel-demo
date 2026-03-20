'use client';

import { type ReactNode, Suspense } from 'react';
import { ModelSelectionProvider } from '@/modules/chat/providers/model-selection-provider';
import { ArtifactProvider } from '../../artifacts/providers/artifact-provider';
import { PendingUploadsProvider } from '../../file-uploads/providers/pending-uploads-provider';
import type { Message } from '../types';
import { ActivePanelProvider } from './active-panel-provider';
import { ChatProvider } from './chat-provider';
import { ScrollTargetProvider } from './scroll-target-provider';

type ChatModuleBaseProps = {
    children: ReactNode;
    initialChatId?: string;
    initialMessages?: Message[];
    chatRouteBuilder?: (chatId: string) => string;
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
    chatRouteBuilder,
}: ChatModuleProps) {
    return (
        <ActivePanelProvider>
            <ArtifactProvider>
                <PendingUploadsProvider>
                    <ModelSelectionProvider>
                        <ChatProvider
                            projectId={projectId}
                            chatType={chatType}
                            initialChatId={initialChatId}
                            initialMessages={initialMessages}
                            chatRouteBuilder={chatRouteBuilder}
                        >
                            <Suspense>
                                <ScrollTargetProvider>{children}</ScrollTargetProvider>
                            </Suspense>
                        </ChatProvider>
                    </ModelSelectionProvider>
                </PendingUploadsProvider>
            </ArtifactProvider>
        </ActivePanelProvider>
    );
}
