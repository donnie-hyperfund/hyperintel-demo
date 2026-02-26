'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ListPageHeader } from '@/components/layouts/list-wrapper/list-page-header';
import { ListPageWrapper } from '@/components/layouts/list-wrapper/list-page-wrapper';
import { Button } from '@/components/ui/button';
import { StakeholderList } from './_components/stakeholder-list';

export default function StakeholdersPage() {
    return (
        <ListPageWrapper
            HeaderComponent={
                <ListPageHeader
                    title="Stakeholder profiles"
                    ActionComponent={
                        <Button asChild size="sm">
                            <Link href="/stakeholders/new">
                                <Plus className="size-4 opacity-75" />
                                New stakeholder
                            </Link>
                        </Button>
                    }
                />
            }
        >
            <StakeholderList />
        </ListPageWrapper>
    );
}
