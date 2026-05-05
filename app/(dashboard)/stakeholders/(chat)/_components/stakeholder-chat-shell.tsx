'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { type ReactNode, Suspense, useEffect, useMemo } from 'react';
import { StakeholderChatInterface } from '@/app/(dashboard)/stakeholders/_components/stakeholder-chat-interface';
import { buildProjectOriginQuery, parseProjectOrigin } from '@/lib/intake/project-origin';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { ProjectOriginProvider } from '@/modules/intake/providers/project-origin-provider';

type RouteParams = Record<string, string | string[] | undefined>;

function readRouteChatId(params: RouteParams): string | undefined {
    return typeof params.chatId === 'string' ? params.chatId : undefined;
}

export function StakeholderChatShell({ children }: { children: ReactNode }) {
    const params = useParams<RouteParams>();
    const searchParams = useSearchParams();
    const initialChatId = readRouteChatId(params);
    const origin = useMemo(() => parseProjectOrigin(searchParams), [searchParams]);
    const buildCreatedChatHref = useMemo(
        () => (origin ? (chatId: string) => `/stakeholders/${chatId}?${buildProjectOriginQuery(origin)}` : undefined),
        [origin],
    );

    return (
        <ProjectOriginProvider origin={origin} resourceType="stakeholder">
            <ChatModule
                chatType="stakeholder"
                initialChatId={initialChatId}
                buildCreatedChatHref={buildCreatedChatHref}
            >
                <Suspense fallback={null}>
                    <IntakeRouteSync />
                </Suspense>
                <StakeholderChatInterface />
                {children}
            </ChatModule>
        </ProjectOriginProvider>
    );
}

function IntakeRouteSync() {
    const params = useParams<RouteParams>();
    const { openChat, startNewChat } = useChatContext<'stakeholder'>();
    const chatId = readRouteChatId(params);

    useEffect(() => {
        if (chatId) {
            void openChat(chatId);
            return;
        }
        startNewChat();
    }, [chatId, openChat, startNewChat]);

    return null;
}
