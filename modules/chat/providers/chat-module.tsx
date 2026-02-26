'use client';

import { type ReactNode, Suspense } from 'react';
import { ArtifactProvider } from '../../artifacts/providers/artifact-provider';
import type { Message } from '../types';
import { ActivePanelProvider } from './active-panel-provider';
import { ChatProvider } from './chat-provider';
import { ScrollTargetProvider } from './scroll-target-provider';

type ChatModuleBaseProps = {
    children: ReactNode;
    initialChatId?: string;
    initialMessages?: Message[];
};

type PhaseChatModuleProps = ChatModuleBaseProps & {
    chatType?: 'phase';
    projectId: string;
};

type IntakeChatModuleProps = ChatModuleBaseProps & {
    chatType: 'company' | 'stakeholder';
    projectId?: never;
};

export type ChatModuleProps = PhaseChatModuleProps | IntakeChatModuleProps;

export function ChatModule({ children, projectId, chatType, initialChatId, initialMessages = [] }: ChatModuleProps) {
    return (
        <ActivePanelProvider>
            <ArtifactProvider>
                <ChatProvider
                    projectId={projectId}
                    chatType={chatType}
                    initialChatId={initialChatId}
                    initialMessages={initialMessages}
                >
                    <Suspense>
                        <ScrollTargetProvider>{children}</ScrollTargetProvider>
                    </Suspense>
                </ChatProvider>
            </ArtifactProvider>
        </ActivePanelProvider>
    );
}
