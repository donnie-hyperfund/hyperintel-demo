'use client';

import { useUser } from '@clerk/nextjs';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'nextjs-toploader/app';
import { ProjectItem, ProjectItemSkeleton } from '@/app/(dashboard)/projects/_components/project-item';
import { Button } from '@/components/ui/button';
import { useFetchProjects } from '@/lib/api/client/hooks/use-projects';
import { setCurrentProjectCookie } from '@/lib/cookies/project';
import type { ProjectDto } from '@/lib/schema/project';

export function RecentProjectsSection() {
    const router = useRouter();
    const { user } = useUser();
    const { data, isLoading, error } = useFetchProjects({ page: 1, limit: 6 });

    const projects = data?.data ?? [];
    const total = data?.pagination.total ?? 0;

    const openProject = (project: ProjectDto) => {
        if (!user?.id) return;
        setCurrentProjectCookie(user.id, project.id);
        router.push(`/${project.id}`);
    };

    const renderContent = () => {
        if (isLoading) return <ProjectsLoading />;
        if (error) return <ProjectsError />;
        if (projects.length === 0) return <ProjectsEmpty />;
        return <ProjectsGrid projects={projects} onOpen={openProject} />;
    };

    return (
        <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.2, ease: 'easeOut' }}
            className="mt-8 rounded-3xl border border-neutral-800 bg-neutral-950/70 p-6 md:p-8"
        >
            <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight">Recent projects</h2>
                    <p className="mt-1 text-neutral-400 text-sm">Pick up where you left off.</p>
                </div>
                {total > projects.length && (
                    <Button variant="outline" asChild className="shrink-0">
                        <Link href="/projects">View all projects</Link>
                    </Button>
                )}
            </div>

            {renderContent()}
        </motion.section>
    );
}

function ProjectsLoading() {
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
                <ProjectItemSkeleton key={i} />
            ))}
        </div>
    );
}

function ProjectsError() {
    return (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-rose-200 text-sm">
            Failed to load projects.
        </div>
    );
}

function ProjectsEmpty() {
    return (
        <div className="rounded-2xl border border-dashed border-neutral-700 px-4 py-10 text-center text-neutral-400 text-sm">
            No projects yet. Create one above to get started.
        </div>
    );
}

function ProjectsGrid({ projects, onOpen }: { projects: ProjectDto[]; onOpen: (project: ProjectDto) => void }) {
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
                <ProjectItem
                    key={project.id}
                    project={project}
                    href={`/${project.id}`}
                    onNavigate={() => onOpen(project)}
                />
            ))}
        </div>
    );
}
