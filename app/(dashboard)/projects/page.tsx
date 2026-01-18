'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ProjectList } from './_components/project-list';

export default function ProjectsPage() {
    return (
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-12">
            <div className="mb-8 flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Your projects</h1>
                <Button asChild size="sm">
                    <Link href="/new-project">
                        <Plus className="size-4 opacity-75" />
                        New project
                    </Link>
                </Button>
            </div>

            <ProjectList />
        </div>
    );
}
