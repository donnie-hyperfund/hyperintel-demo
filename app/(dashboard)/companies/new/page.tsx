'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { buildProjectOriginQuery, parseProjectOrigin } from '@/lib/intake/project-origin';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import { ProjectOriginProvider } from '@/modules/intake/providers/project-origin-provider';
import { CompanyChatInterface } from '../_components/company-chat-interface';

export default function NewCompanyPage() {
    const searchParams = useSearchParams();
    const origin = useMemo(() => parseProjectOrigin(searchParams), [searchParams]);
    const chatRouteBuilder = useMemo(
        () => (origin ? (chatId: string) => `/companies/${chatId}?${buildProjectOriginQuery(origin)}` : undefined),
        [origin],
    );

    return (
        <ChatModule chatType="company" chatRouteBuilder={chatRouteBuilder}>
            <ProjectOriginProvider origin={origin} resourceType="company">
                <CompanyChatInterface title="New company" />
            </ProjectOriginProvider>
        </ChatModule>
    );
}
