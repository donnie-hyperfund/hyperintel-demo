'use client';

import { type ReactNode, Suspense } from 'react';
import { StakeholderChatInterface } from '@/app/(dashboard)/stakeholders/_components/stakeholder-chat-interface';
import { useRouteChatId } from '@/modules/chat/hooks/use-route-chat-id';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import { IntakeRouteSync } from '@/modules/intake/components/intake-route-sync';
import { ProjectOriginProvider } from '@/modules/intake/providers/project-origin-provider';

export function StakeholderChatShell({ children }: { children: ReactNode }) {
    const initialChatId = useRouteChatId();

    return (
        <ProjectOriginProvider resourceType="stakeholder">
            <ChatModule chatType="stakeholder" initialChatId={initialChatId}>
                <Suspense fallback={null}>
                    <IntakeRouteSync />
                </Suspense>
                <StakeholderChatInterface />
                {children}
            </ChatModule>
        </ProjectOriginProvider>
    );
}
