'use client';

import { type ReactNode, Suspense } from 'react';
import { CompanyChatInterface } from '@/app/(dashboard)/companies/_components/company-chat-interface';
import { useRouteChatId } from '@/modules/chat/hooks/use-route-chat-id';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import { IntakeRouteSync } from '@/modules/intake/components/intake-route-sync';
import { ProjectOriginProvider } from '@/modules/intake/providers/project-origin-provider';

export function CompanyChatShell({ children }: { children: ReactNode }) {
    const initialChatId = useRouteChatId();

    return (
        <ProjectOriginProvider resourceType="company">
            <ChatModule chatType="company" initialChatId={initialChatId}>
                <Suspense fallback={null}>
                    <IntakeRouteSync />
                </Suspense>
                <CompanyChatInterface />
                {children}
            </ChatModule>
        </ProjectOriginProvider>
    );
}
