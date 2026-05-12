'use client';

import { useUser } from '@clerk/nextjs';
import { format } from 'date-fns';
import { Archive, Loader2, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { useUpdateProject } from '@/lib/api/client/hooks/use-projects';
import type { CamelCaseDto } from '@/lib/api/client/types';
import { clearCurrentProjectCookie, getCurrentProjectFromCookie } from '@/lib/cookies/project';
import type { ProjectDto } from '@/lib/schema/project';
import { cn } from '@/lib/utils';

type ProjectItemProps = {
    project: CamelCaseDto<ProjectDto>;
    href?: string;
    isSelected?: boolean;
    onNavigate?: () => void;
};

type ProjectItemContentProps = {
    name: string;
    description: string | null | undefined;
    isArchived: boolean;
    displayDate: string | null;
};

type ArchiveToggleButtonProps = {
    isArchived: boolean;
    isMutating: boolean;
    onToggle: () => void;
    className?: string;
};

function clearProjectCookieIfNeeded(userId: string | undefined, projectId: string) {
    if (!userId) return;
    const currentProject = getCurrentProjectFromCookie();
    if (currentProject?.userId === userId && currentProject.projectId === projectId) {
        clearCurrentProjectCookie();
    }
}

export const ProjectItem = ({ project, href, isSelected, onNavigate }: ProjectItemProps) => {
    const { user } = useUser();
    const { trigger: updateProject, isMutating } = useUpdateProject(project.id);

    const isArchived = Boolean(project.archivedAt);
    const displayDate =
        isArchived && project.archivedAt
            ? `Archived ${format(new Date(project.archivedAt), 'MMM d, yyyy')}`
            : project.createdAt
              ? `Created ${format(new Date(project.createdAt), 'MMM d, yyyy')}`
              : null;

    const handleArchiveToggle = async () => {
        try {
            clearProjectCookieIfNeeded(user?.id, project.id);
            await updateProject({ archived: !isArchived });
            toast({ title: isArchived ? `"${project.name}" restored` : `"${project.name}" archived` });
        } catch (error) {
            console.error('Failed to update project lifecycle:', error);
            toast({
                title: isArchived ? 'Failed to restore project' : 'Failed to archive project',
                variant: 'destructive',
            });
        }
    };

    return (
        <div
            className={cn(
                'group relative flex flex-col rounded-2 border p-3.5 transition-colors md:rounded-3 md:p-5',
                isSelected ? 'border-neutral-500/30 bg-neutral-900' : 'border-border',
                isArchived && 'border-dashed',
                href && 'hover:bg-accent/50',
            )}
        >
            {href && (
                <Link
                    href={href}
                    onNavigate={onNavigate}
                    className="absolute inset-0 rounded-[inherit]"
                    aria-label={project.name}
                />
            )}
            <ProjectItemContent
                name={project.name}
                description={project.description}
                isArchived={isArchived}
                displayDate={displayDate}
            />
            <ArchiveToggleButton
                isArchived={isArchived}
                isMutating={isMutating}
                onToggle={handleArchiveToggle}
                className={cn(
                    'absolute right-3.5 top-3.5 z-10 text-neutral-400 transition-opacity md:right-5 md:top-5',
                    isMutating ? 'opacity-100' : 'opacity-0 max-md:opacity-100 group-hover:opacity-100',
                )}
            />
        </div>
    );
};

function ProjectItemContent({ name, description, isArchived, displayDate }: ProjectItemContentProps) {
    return (
        <>
            <div className="mb-1.5 flex items-center gap-2 pr-8">
                <div className="line-clamp-1 break-all text-sm font-medium md:text-md">{name}</div>
                {isArchived && (
                    <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-200">
                        Archived
                    </span>
                )}
            </div>
            <div className="mb-3 line-clamp-2 break-all text-xs text-neutral-500 md:text-sm">
                {description || <span className="text-neutral-600">No description</span>}
            </div>
            {displayDate && <div className="mt-0.5 text-xs text-neutral-500">{displayDate}</div>}
        </>
    );
}

function ArchiveToggleButton({ isArchived, isMutating, onToggle, className }: ArchiveToggleButtonProps) {
    let ActionIcon = Archive;
    if (isMutating) ActionIcon = Loader2;
    else if (isArchived) ActionIcon = RotateCcw;

    const label = isMutating ? (isArchived ? 'Restoring...' : 'Archiving...') : isArchived ? 'Restore' : 'Archive';

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <IconButton size="sm" disabled={isMutating} onClick={onToggle} className={className}>
                    <ActionIcon className={cn(isMutating && 'animate-spin')} />
                </IconButton>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

export const ProjectItemSkeleton = () => {
    return (
        <div className="flex flex-col rounded-2 border p-3.5 md:rounded-3 md:p-5">
            <Skeleton className="h-5 w-3/4 mb-1.5" />
            <Skeleton className="h-4 w-full mb-3 md:h-5" />
            <Skeleton className="h-4 w-32 mt-0.5" />
        </div>
    );
};
