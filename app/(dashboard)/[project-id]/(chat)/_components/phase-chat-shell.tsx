'use client';

import { type ReactNode, Suspense } from 'react';
import { useRouteChatId } from '@/modules/chat/hooks/use-route-chat-id';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import PhaseChatInterface from './phase-chat-interface';
import { PhaseRouteSync } from './phase-route-sync';

type PhaseChatShellProps = {
    projectId: string;
    children: ReactNode;
};

export function PhaseChatShell({ projectId, children }: PhaseChatShellProps) {
    const initialChatId = useRouteChatId();

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
