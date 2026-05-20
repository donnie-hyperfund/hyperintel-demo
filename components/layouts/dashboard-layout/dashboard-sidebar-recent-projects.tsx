'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSkeleton,
} from '@/components/ui/sidebar';
import { useOpenProject } from '@/hooks/use-open-project';
import { RECENT_PROJECTS_LIMIT, useRecentProjects } from '@/lib/api/client/hooks/use-recent-projects';
import { cn } from '@/lib/utils';

export function DashboardSidebarRecentProjects() {
    const { projects, isLoading, error } = useRecentProjects();
    const { markProjectActive } = useOpenProject();
    const params = useParams<{ 'project-id'?: string }>();
    const activeProjectId = params?.['project-id'];

    return (
        <SidebarGroup className="px-2">
            <SidebarGroupLabel className="px-4 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                Recent Projects
            </SidebarGroupLabel>
            <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                    <RecentProjectsBody
                        isLoading={isLoading}
                        error={error}
                        projects={projects}
                        activeProjectId={activeProjectId}
                        onSelect={markProjectActive}
                    />
                </SidebarMenu>
            </SidebarGroupContent>
        </SidebarGroup>
    );
}

type RecentProjectsBodyProps = {
    isLoading: boolean;
    error: ReturnType<typeof useRecentProjects>['error'];
    projects: ReturnType<typeof useRecentProjects>['projects'];
    activeProjectId: string | undefined;
    onSelect: ReturnType<typeof useOpenProject>['markProjectActive'];
};

function RecentProjectsBody({ isLoading, error, projects, activeProjectId, onSelect }: RecentProjectsBodyProps) {
    if (isLoading) {
        return Array.from({ length: 3 }).map((_, index) => (
            <SidebarMenuItem key={index}>
                <SidebarMenuSkeleton />
            </SidebarMenuItem>
        ));
    }

    if (error) {
        return <RecentProjectsMessage>Failed to load projects</RecentProjectsMessage>;
    }

    if (projects.length === 0) {
        return <RecentProjectsMessage>No projects yet</RecentProjectsMessage>;
    }

    return projects.slice(0, RECENT_PROJECTS_LIMIT).map((project) => {
        const isActive = project.id === activeProjectId;
        return (
            <SidebarMenuItem key={project.id}>
                <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    className={cn('px-4', isActive && 'bg-neutral-850 text-neutral-100')}
                >
                    <Link href={`/${project.id}`} onNavigate={() => onSelect(project)}>
                        <span className="truncate">{project.name}</span>
                    </Link>
                </SidebarMenuButton>
            </SidebarMenuItem>
        );
    });
}

function RecentProjectsMessage({ children }: { children: React.ReactNode }) {
    return <div className="px-4 py-1.5 text-xs text-neutral-500">{children}</div>;
}
