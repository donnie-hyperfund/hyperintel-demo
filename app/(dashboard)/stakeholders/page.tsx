'use client';

import { MessageSquareDashed, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ListPageHeader } from '@/components/layouts/list-wrapper/list-page-header';
import { ListPageWrapper } from '@/components/layouts/list-wrapper/list-page-wrapper';
import { Button } from '@/components/ui/button';
import { StakeholderList } from './_components/stakeholder-list';

export default function StakeholdersPage() {
    const [isEmpty, setIsEmpty] = useState(true);

    return (
        <ListPageWrapper
            HeaderComponent={
                <ListPageHeader
                    title="Stakeholder personas"
                    ActionComponent={
                        <div className="flex items-center gap-2">
                            <Button asChild variant="outline" size="sm">
                                <Link href="/stakeholders/incomplete">
                                    <MessageSquareDashed className="size-4 opacity-75" />
                                    Incomplete
                                </Link>
                            </Button>
                            {!isEmpty && (
                                <Button asChild size="sm">
                                    <Link href="/stakeholders/new">
                                        <Plus className="size-4 opacity-75" />
                                        New persona
                                    </Link>
                                </Button>
                            )}
                        </div>
                    }
                />
            }
        >
            <StakeholderList onEmptyChange={setIsEmpty} />
        </ListPageWrapper>
    );
}
