'use client';

import { Users } from 'lucide-react';
import { ListBackLink } from '@/components/layouts/list-wrapper/list-back-link';
import { ListPageHeader } from '@/components/layouts/list-wrapper/list-page-header';
import { ListPageWrapper } from '@/components/layouts/list-wrapper/list-page-wrapper';
import { IncompleteChats } from '@/modules/intake/components/incomplete-chats';

export default function StakeholdersIncompletePage() {
    return (
        <ListPageWrapper
            HeaderComponent={
                <ListPageHeader
                    title="Incomplete conversations"
                    BackComponent={<ListBackLink href="/stakeholders">Stakeholder personas</ListBackLink>}
                />
            }
        >
            <IncompleteChats
                framework="hpf"
                basePath="/stakeholders"
                emptyIcon={Users}
                emptyTitle="No incomplete conversations"
            />
        </ListPageWrapper>
    );
}
