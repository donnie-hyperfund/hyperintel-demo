'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { parseProjectOrigin } from '@/lib/intake/project-origin';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import { ProjectOriginProvider } from '@/modules/intake/providers/project-origin-provider';
import { StakeholderChatInterface } from '../_components/stakeholder-chat-interface';

export default function ExistingStakeholderChatPage() {
    const { chatId } = useParams<{ chatId: string }>();
    const searchParams = useSearchParams();
    const origin = useMemo(() => parseProjectOrigin(searchParams), [searchParams]);

    return (
        <ProjectOriginProvider origin={origin} resourceType="stakeholder">
            <ChatModule chatType="stakeholder" initialChatId={chatId}>
                <StakeholderChatInterface title="Stakeholder chat" />
            </ChatModule>
        </ProjectOriginProvider>
    );
}
