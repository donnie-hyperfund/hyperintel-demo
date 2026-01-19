'use client';

import { FileCode, Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchProjects } from '@/lib/api/client/hooks/use-projects';
import { ProjectItem, ProjectItemSkeleton } from './project-item';

export const ProjectList = () => {
    const { data, error, isLoading } = useFetchProjects();
    const projects = data?.data ?? [];

    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={FileCode}
                    title="Failed to load projects"
                    error={error instanceof Error ? error.message : 'An error occurred while loading your projects.'}
                />
            </div>
        );
    }

    if (projects.length === 0 && !isLoading) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={FileCode}
                    title="No projects yet"
                    description="Create your first project to start organizing your chats and artifacts."
                >
                    <Button asChild className="mt-2">
                        <Link href="/new-project">
                            <Plus className="size-4" />
                            Create project
                        </Link>
                    </Button>
                </EmptyState>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                    <ProjectItemSkeleton key={index} />
                ))}
            </div>
        );
    }

    return (
        <>
            <p className="mb-4 text-sm text-neutral-500">
                {projects.length} project{projects.length !== 1 ? 's' : ''}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
                {projects.map((project) => (
                    <ProjectItem key={project.id} project={project} />
                ))}
            </div>
        </>
    );
};
