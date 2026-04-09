'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ListPageHeader } from '@/components/layouts/list-wrapper/list-page-header';
import { ListPageWrapper } from '@/components/layouts/list-wrapper/list-page-wrapper';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ProjectListStatus } from '@/lib/schema/project';
import { ProjectList } from './_components/project-list';

export default function ProjectsPage() {
    const [isEmpty, setIsEmpty] = useState(true);
    const [status, setStatus] = useState<ProjectListStatus>('active');

    return (
        <ListPageWrapper
            HeaderComponent={
                <ListPageHeader
                    title="Projects"
                    ActionComponent={
                        isEmpty || status !== 'active' ? undefined : (
                            <Button asChild size="sm">
                                <Link href="/projects/new">
                                    <Plus className="size-4 opacity-75" />
                                    New project
                                </Link>
                            </Button>
                        )
                    }
                />
            }
        >
            <Tabs value={status} onValueChange={(value) => setStatus(value as ProjectListStatus)}>
                <TabsList>
                    <TabsTrigger value="active">Active</TabsTrigger>
                    <TabsTrigger value="archived">Archived</TabsTrigger>
                </TabsList>
            </Tabs>
            <ProjectList status={status} onEmptyChange={setIsEmpty} />
        </ListPageWrapper>
    );
}
