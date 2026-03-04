'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ListPageHeader } from '@/components/layouts/list-wrapper/list-page-header';
import { ListPageWrapper } from '@/components/layouts/list-wrapper/list-page-wrapper';
import { Button } from '@/components/ui/button';
import { CompanyList } from './_components/company-list';

export default function CompaniesPage() {
    return (
        <ListPageWrapper
            HeaderComponent={
                <ListPageHeader
                    title="Company profiles"
                    ActionComponent={
                        <Button asChild size="sm">
                            <Link href="/companies/new">
                                <Plus className="size-4 opacity-75" />
                                New profile
                            </Link>
                        </Button>
                    }
                />
            }
        >
            <CompanyList />
        </ListPageWrapper>
    );
}
