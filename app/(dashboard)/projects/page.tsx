'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ListPageHeader } from '@/components/layouts/list-wrapper/list-page-header';
import { ListPageWrapper } from '@/components/layouts/list-wrapper/list-page-wrapper';
import { Button } from '@/components/ui/button';
import { ProjectList } from './_components/project-list';

export default function ProjectsPage() {
    return (
        <ListPageWrapper
            HeaderComponent={
                <ListPageHeader
                    title="Your projects"
                    ActionComponent={
                        <Button asChild size="sm">
                            <Link href="/projects/new">
                                <Plus className="size-4 opacity-75" />
                                New project
                            </Link>
                        </Button>
                    }
                />
            }
        >
            <ProjectList />
        </ListPageWrapper>
    );
}
