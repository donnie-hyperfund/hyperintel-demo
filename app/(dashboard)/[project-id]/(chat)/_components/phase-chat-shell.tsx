'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { type ReactNode, Suspense, useEffect } from 'react';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import PhaseChatInterface from './phase-chat-interface';

type PhaseChatShellProps = {
    projectId: string;
    children: ReactNode;
};

type RouteParams = Record<string, string | string[] | undefined>;

function readRouteChatId(params: RouteParams): string | undefined {
    return typeof params.chatId === 'string' ? params.chatId : undefined;
}

export function PhaseChatShell({ projectId, children }: PhaseChatShellProps) {
    const params = useParams<RouteParams>();
    const initialChatId = readRouteChatId(params);

    return (
        <ChatModule chatType="phase" projectId={projectId} initialChatId={initialChatId}>
            <Suspense fallback={null}>
                <PhaseRouteSync />
            </Suspense>
            <PhaseChatInterface />
            {children}
        </ChatModule>
    );
}

// Drives provider state from URL params; mounted inside ChatModule for context access.
function PhaseRouteSync() {
    const params = useParams<RouteParams>();
    const searchParams = useSearchParams();
    const { openChat, startNewChat } = useChatContext<'phase'>();
    const chatId = readRouteChatId(params);
    const isNewIntent = searchParams.has('new');

    useEffect(() => {
        if (chatId) {
            void openChat(chatId);
            return;
        }
        if (isNewIntent) {
            startNewChat();
        }
    }, [chatId, isNewIntent, openChat, startNewChat]);

    return null;
}
