'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, Suspense, useCallback } from 'react';
import { buildProjectOriginQuery } from '@/lib/intake/project-origin';
import { ArtifactScopeProvider, getArtifactScopeForProject } from '@/modules/artifacts/providers/artifact-provider';
import { ChatLoader } from '@/modules/chat/components/chat-loader';
import { ModelSelectionProvider } from '@/modules/chat/providers/model-selection-provider';
import { useOptionalProjectOrigin } from '@/modules/intake/providers/project-origin-provider';
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
    const { origin } = useOptionalProjectOrigin();
    const artifactScope = getArtifactScopeForProject(projectId);

    const buildChatRoute = useCallback(
        (nextChatId: string) => {
            if (buildCreatedChatHref) {
                return buildCreatedChatHref(nextChatId);
            }

            if (chatType === 'phase') {
                if (!projectId) throw new Error('Project ID is required for phase chats');
                return `/${projectId}/${nextChatId}`;
            }

            const basePath = `/${chatType === 'company' ? 'companies' : 'stakeholders'}/${nextChatId}`;
            return origin ? `${basePath}?${buildProjectOriginQuery(origin)}` : basePath;
        },
        [buildCreatedChatHref, chatType, projectId, origin],
    );

    const handleChatCreated = useCallback(
        (chatId: string) => {
            router.replace(buildChatRoute(chatId), { scroll: false });
        },
        [buildChatRoute, router],
    );

    return (
        <ActivePanelProvider>
            <ArtifactScopeProvider scope={artifactScope}>
                <ModelSelectionProvider projectId={projectId}>
                    <ChatProvider
                        projectId={projectId}
                        chatType={chatType}
                        initialChatId={initialChatId}
                        initialMessages={initialMessages}
                        onChatCreated={handleChatCreated}
                    >
                        <Suspense fallback={<ChatLoader />}>
                            <ScrollTargetProvider>{children}</ScrollTargetProvider>
                        </Suspense>
                    </ChatProvider>
                </ModelSelectionProvider>
            </ArtifactScopeProvider>
        </ActivePanelProvider>
    );
}
