'use client';

import { useUser } from '@clerk/nextjs';
import { FileCode, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProjectCard } from '@/app/_components/project-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useFetchProjects } from '@/lib/api/client/hooks/use-projects';
import { setCurrentProjectCookie } from '@/lib/cookies/project';
import { cn } from '@/lib/utils';

const getGridClassName = (itemCount: number) => {
    if (itemCount === 1) return 'grid gap-6 max-w-sm';
    return 'grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
};

export default function ProjectsPage() {
    const router = useRouter();
    const { user } = useUser();
    const { data, error, isLoading } = useFetchProjects();

    const projects = data?.data ?? [];
    const hasProjects = projects.length > 0;

    const renderContent = () => {
        if (isLoading) {
            return (
                <div className="flex min-h-[300px] items-center justify-center">
                    <Spinner className="size-8" />
                </div>
            );
        }

        if (error) {
            return (
                <EmptyState
                    icon={FileCode}
                    title="Failed to load projects"
                    error={error instanceof Error ? error.message : 'An error occurred while loading your projects.'}
                />
            );
        }

        if (hasProjects) {
            return (
                <div className={getGridClassName(projects.length)}>
                    {projects.map((project) => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            onClick={() => {
                                if (!user?.id) return;
                                setCurrentProjectCookie(user.id, project.id);
                                router.push(`/${project.id}`);
                            }}
                        />
                    ))}
                </div>
            );
        }

        return (
            <EmptyState
                icon={FileCode}
                title="No projects yet"
                description="Create your first project to start organizing your chats and artifacts."
            >
                <Button asChild>
                    <Link href="/new-project">
                        <Plus className="size-4" />
                        Create project
                    </Link>
                </Button>
            </EmptyState>
        );
    };

    return (
        <div className="container mx-auto max-w-5xl p-6">
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
                    <p className={cn('text-neutral-500 mt-2 text-sm', isLoading && 'invisible')}>
                        {hasProjects
                            ? `${data?.pagination.total ?? 0} project${(data?.pagination.total ?? 0) !== 1 ? 's' : ''}`
                            : 'Get started by creating your first project'}
                    </p>
                </div>
                <Button asChild size="lg">
                    <Link href="/new-project">
                        <Plus className="size-4" />
                        Create project
                    </Link>
                </Button>
            </div>

            {renderContent()}
        </div>
    );
}
