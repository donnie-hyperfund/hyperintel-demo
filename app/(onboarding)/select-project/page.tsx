'use client';

import { useUser } from '@clerk/nextjs';
import { FileCode, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProjectCard } from '@/app/_components/project-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useFetchProjects } from '@/lib/api/client/hooks/use-projects';
import { setCurrentProjectCookie } from '@/lib/cookies/project';
import { cn } from '@/lib/utils';

export default function SelectProjectPage() {
    const router = useRouter();
    const { user } = useUser();
    const { data, error, isLoading } = useFetchProjects();

    const projects = data?.data ?? [];

    const handleSelectProject = (projectId: string) => {
        if (!user?.id) return;
        setCurrentProjectCookie(user.id, projectId);
        router.push(`/${projectId}`);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center">
                <Spinner className="size-8" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="mx-auto w-full max-w-2xl">
                <EmptyState
                    icon={FileCode}
                    title="Failed to load projects"
                    error={error instanceof Error ? error.message : 'An error occurred while loading your projects.'}
                />
            </div>
        );
    }

    if (projects.length === 0) {
        return (
            <div className="mx-auto w-full max-w-2xl">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                    className="mb-8 space-y-2 text-center"
                >
                    <h1 className="text-3xl font-semibold tracking-tight">No projects yet</h1>
                    <p className="text-neutral-500 text-sm leading-relaxed">
                        Create your first project to get started.
                    </p>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4, ease: 'easeOut' }}
                    className="self-stretch flex justify-center"
                >
                    <Button asChild className="w-full max-w-[24rem]" size="xl">
                        <Link href="/projects/new">Create project</Link>
                    </Button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-2xl">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="mb-8 space-y-2 text-center"
            >
                <h1 className="text-3xl font-semibold tracking-tight">Select a project</h1>
                <p className="text-neutral-500 text-sm leading-relaxed">
                    Choose a project to continue working on, or create a new one.
                </p>
            </motion.div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
                className="space-y-4"
            >
                <div className={cn('grid gap-4 grid-cols-1', projects.length > 1 && 'sm:grid-cols-2')}>
                    {projects.map((project) => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            onClick={() => handleSelectProject(project.id)}
                        />
                    ))}
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4, ease: 'easeOut' }}
                    className="self-stretch flex justify-center pt-4"
                >
                    <Button variant="outline" asChild size="xl" className="w-full max-w-[24rem]">
                        <Link href="/projects/new">
                            <Plus className="size-4" />
                            Create new project
                        </Link>
                    </Button>
                </motion.div>
            </motion.div>
        </div>
    );
}
