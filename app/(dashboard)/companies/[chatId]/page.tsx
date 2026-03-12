'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { parseProjectOrigin } from '@/lib/intake/project-origin';
import { ProjectOriginProvider } from '@/modules/intake/providers/project-origin-provider';
import { CompanyChatInterface } from '../_components/company-chat-interface';

export default function ExistingCompanyChatPage() {
    const searchParams = useSearchParams();
    const origin = useMemo(() => parseProjectOrigin(searchParams), [searchParams]);

    return (
        <ProjectOriginProvider origin={origin} resourceType="company">
            <CompanyChatInterface title="Company chat" />
        </ProjectOriginProvider>
    );
}
