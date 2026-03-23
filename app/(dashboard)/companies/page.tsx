'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ListPageHeader } from '@/components/layouts/list-wrapper/list-page-header';
import { ListPageWrapper } from '@/components/layouts/list-wrapper/list-page-wrapper';
import { Button } from '@/components/ui/button';
import { CompanyList } from './_components/company-list';

export default function CompaniesPage() {
    const [isEmpty, setIsEmpty] = useState(true);

    return (
        <ListPageWrapper
            HeaderComponent={
                <ListPageHeader
                    title="Company profiles"
                    ActionComponent={
                        isEmpty ? undefined : (
                            <Button asChild size="sm">
                                <Link href="/companies/new">
                                    <Plus className="size-4 opacity-75" />
                                    New profile
                                </Link>
                            </Button>
                        )
                    }
                />
            }
        >
            <CompanyList onEmptyChange={setIsEmpty} />
        </ListPageWrapper>
    );
}
