'use client';

import { useUser } from '@clerk/nextjs';
import { FileCode, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchProjects } from '@/lib/api/client/hooks/use-projects';
import { setCurrentProjectCookie } from '@/lib/cookies/project';
import type { ProjectDto } from '@/lib/schema/project';
import { ProjectItem, ProjectItemSkeleton } from './project-item';

export const ProjectList = () => {
    const { user } = useUser();
    const { data, error, isLoading } = useFetchProjects();
    const projects = data?.data ?? [];

    const handleProjectNavigate = useCallback(
        (project: ProjectDto) => {
            if (!user?.id) return;
            setCurrentProjectCookie(user.id, project.id);
        },
        [user?.id],
    );

    if (error) {
        return (
            <EmptyState
                className="flex-1"
                icon={FileCode}
                title="Failed to load projects"
                error={error instanceof Error ? error.message : 'An error occurred while loading your projects.'}
            />
        );
    }

    if (projects.length === 0 && !isLoading) {
        return (
            <EmptyState
                className="flex-1"
                icon={FileCode}
                title="No projects yet"
                description="Create your first project to start organizing your chats and deliverables."
            >
                <Button asChild className="mt-2">
                    <Link href="/projects/new">
                        <Plus className="size-4" />
                        Create project
                    </Link>
                </Button>
            </EmptyState>
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
        <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
                <ProjectItem
                    key={project.id}
                    project={project}
                    href={`/${project.id}`}
                    onNavigate={() => handleProjectNavigate(project)}
                />
            ))}
        </div>
    );
};
