'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ProjectList } from './_components/project-list';

export default function ProjectsPage() {
    const params = useParams<{ 'project-id': string }>();
    const currentProjectId = params['project-id'];

    return (
        <div className="flex h-full w-full flex-col items-center overflow-y-auto px-4 py-12">
            <div className="w-full max-w-4xl">
                <div className="mb-8 flex shrink-0 items-center justify-between">
                    <h1 className="text-2xl font-semibold">Your projects</h1>
                    <Button asChild size="sm">
                        <Link href="/new-project">
                            <Plus className="size-4 opacity-75" />
                            New project
                        </Link>
                    </Button>
                </div>

                <ProjectList currentProjectId={currentProjectId} />
            </div>
        </div>
    );
}
