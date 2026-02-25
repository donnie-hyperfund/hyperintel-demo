'use client';

import { type ReactNode, Suspense } from 'react';
import type { IntakeFramework, PersonaCategory } from '@/lib/schema/chat';
import type { Message } from '../types';
import { ActivePanelProvider } from './active-panel-provider';
import { ArtifactProvider } from './artifact-provider';
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
    intakeConfig?: never;
};

type IntakeChatModuleProps = ChatModuleBaseProps & {
    chatType: 'company' | 'stakeholder';
    projectId?: never;
    intakeConfig: { framework: IntakeFramework; category?: PersonaCategory };
};

export type ChatModuleProps = PhaseChatModuleProps | IntakeChatModuleProps;

export function ChatModule({
    children,
    projectId,
    chatType,
    intakeConfig,
    initialChatId,
    initialMessages = [],
}: ChatModuleProps) {
    return (
        <ActivePanelProvider>
            <ArtifactProvider>
                <ChatProvider
                    projectId={projectId}
                    chatType={chatType}
                    intakeConfig={intakeConfig}
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
