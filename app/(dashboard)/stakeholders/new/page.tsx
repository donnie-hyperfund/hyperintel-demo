'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { buildProjectOriginQuery, parseProjectOrigin } from '@/lib/intake/project-origin';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import { ProjectOriginProvider } from '@/modules/intake/providers/project-origin-provider';
import { StakeholderChatInterface } from '../_components/stakeholder-chat-interface';

export default function NewStakeholderPage() {
    const searchParams = useSearchParams();
    const origin = useMemo(() => parseProjectOrigin(searchParams), [searchParams]);
    const chatRouteBuilder = useMemo(
        () => (origin ? (chatId: string) => `/stakeholders/${chatId}?${buildProjectOriginQuery(origin)}` : undefined),
        [origin],
    );

    return (
        <ChatModule chatType="stakeholder" chatRouteBuilder={chatRouteBuilder}>
            <ProjectOriginProvider origin={origin} resourceType="stakeholder">
                <StakeholderChatInterface title="New stakeholder" />
            </ProjectOriginProvider>
        </ChatModule>
    );
}
