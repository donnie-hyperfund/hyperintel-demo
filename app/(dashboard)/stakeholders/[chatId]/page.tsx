'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { parseProjectOrigin } from '@/lib/intake/project-origin';
import { ProjectOriginProvider } from '@/modules/intake/providers/project-origin-provider';
import { StakeholderChatInterface } from '../_components/stakeholder-chat-interface';

export default function ExistingStakeholderChatPage() {
    const searchParams = useSearchParams();
    const origin = useMemo(() => parseProjectOrigin(searchParams), [searchParams]);

    return (
        <ProjectOriginProvider origin={origin} resourceType="stakeholder">
            <StakeholderChatInterface title="Stakeholder chat" />
        </ProjectOriginProvider>
    );
}
