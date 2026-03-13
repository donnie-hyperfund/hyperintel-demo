'use client';

import { useUser } from '@clerk/nextjs';
import { FileCode, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchProjectsInfinite } from '@/lib/api/client/hooks/use-projects';
import { setCurrentProjectCookie } from '@/lib/cookies/project';
import type { ProjectDto } from '@/lib/schema/project';
import { ProjectItem, ProjectItemSkeleton } from './project-item';

const PAGE_SIZE = 20;

export const ProjectList = () => {
    const { user } = useUser();
    const { data, error, isLoading, size, setSize, hasNextPage } = useFetchProjectsInfinite({ limit: PAGE_SIZE });

    const projects = useMemo(() => {
        if (!data) return [];
        return data.flatMap((page) => page.data);
    }, [data]);

    const [sentryRef] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => setSize(size + 1),
        rootMargin: '0px 0px 100px 0px',
    });

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
                description="Create your first project to start organizing your chats and artifacts."
            >
                <Button asChild className="mt-2">
                    <Link href="/projects/new">
                        <Plus className="size-4" />
                        New project
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
            {(isLoading || hasNextPage) && (
                <div ref={sentryRef} className="flex items-center justify-center py-3 sm:col-span-2">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
            )}
        </div>
    );
};
