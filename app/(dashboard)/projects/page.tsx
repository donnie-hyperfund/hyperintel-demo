'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ListPageHeader } from '@/components/layouts/list-wrapper/list-page-header';
import { ListPageWrapper } from '@/components/layouts/list-wrapper/list-page-wrapper';
import { Button } from '@/components/ui/button';
import { ProjectList } from './_components/project-list';

export default function ProjectsPage() {
    const [isEmpty, setIsEmpty] = useState(true);

    return (
        <ListPageWrapper
            HeaderComponent={
                <ListPageHeader
                    title="Projects"
                    ActionComponent={
                        isEmpty ? undefined : (
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
            <ProjectList onEmptyChange={setIsEmpty} />
        </ListPageWrapper>
    );
}
