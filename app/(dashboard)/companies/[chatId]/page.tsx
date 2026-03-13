'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { parseProjectOrigin } from '@/lib/intake/project-origin';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import { ProjectOriginProvider } from '@/modules/intake/providers/project-origin-provider';
import { CompanyChatInterface } from '../_components/company-chat-interface';

export default function ExistingCompanyChatPage() {
    const { chatId } = useParams<{ chatId: string }>();
    const searchParams = useSearchParams();
    const origin = useMemo(() => parseProjectOrigin(searchParams), [searchParams]);

    return (
        <ProjectOriginProvider origin={origin} resourceType="company">
            <ChatModule chatType="company" initialChatId={chatId}>
                <CompanyChatInterface title="Company chat" />
            </ChatModule>
        </ProjectOriginProvider>
    );
}
