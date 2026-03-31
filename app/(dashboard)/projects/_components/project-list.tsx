'use client';

import { useUser } from '@clerk/nextjs';
import { FileCode, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchProjectsInfinite } from '@/lib/api/client/hooks/use-projects';
import { setCurrentProjectCookie } from '@/lib/cookies/project';
import type { ProjectDto, ProjectListStatus } from '@/lib/schema/project';
import { ProjectItem, ProjectItemSkeleton } from './project-item';

const PAGE_SIZE = 20;

type ProjectListProps = {
    status: ProjectListStatus;
    onEmptyChange?: (isEmpty: boolean) => void;
};

export const ProjectList = ({ status, onEmptyChange }: ProjectListProps) => {
    const { user } = useUser();
    const { data, error, isLoading, size, setSize, hasNextPage } = useFetchProjectsInfinite({
        limit: PAGE_SIZE,
        status,
    });

    const projects = useMemo(() => {
        if (!data) return [];
        return data.flatMap((page) => page.data);
    }, [data]);

    useEffect(() => {
        if (!isLoading) {
            onEmptyChange?.(projects.length === 0);
        }
    }, [projects.length, isLoading, onEmptyChange]);

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
        const isArchivedView = status === 'archived';
        return (
            <EmptyState
                className="flex-1"
                icon={FileCode}
                title={isArchivedView ? 'No archived projects' : 'No projects yet'}
                description={
                    isArchivedView
                        ? 'Archived projects will appear here until you restore or permanently delete them.'
                        : 'Create your first project to start organizing your chats and artifacts.'
                }
            >
                {!isArchivedView && (
                    <Button asChild className="mt-2">
                        <Link href="/projects/new">
                            <Plus className="size-4" />
                            New project
                        </Link>
                    </Button>
                )}
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
                    href={status === 'active' ? `/${project.id}` : undefined}
                    onNavigate={status === 'active' ? () => handleProjectNavigate(project) : undefined}
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
