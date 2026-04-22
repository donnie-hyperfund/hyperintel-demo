'use client';

import { Building } from 'lucide-react';
import { ListBackLink } from '@/components/layouts/list-wrapper/list-back-link';
import { ListPageHeader } from '@/components/layouts/list-wrapper/list-page-header';
import { ListPageWrapper } from '@/components/layouts/list-wrapper/list-page-wrapper';
import { IncompleteChats } from '@/modules/intake/components/incomplete-chats';

export default function CompaniesIncompletePage() {
    return (
        <ListPageWrapper
            HeaderComponent={
                <ListPageHeader
                    title="Incomplete conversations"
                    BackComponent={<ListBackLink href="/companies">Company profiles</ListBackLink>}
                />
            }
        >
            <IncompleteChats
                framework="cpf"
                basePath="/companies"
                emptyIcon={Building}
                emptyTitle="No incomplete conversations"
            />
        </ListPageWrapper>
    );
}
