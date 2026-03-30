'use client';

import { useUser } from '@clerk/nextjs';
import { format } from 'date-fns';
import { Archive, Loader2, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { useDeleteProject, useUpdateProject } from '@/lib/api/client/hooks/use-projects';
import { clearCurrentProjectCookie, getCurrentProjectFromCookie } from '@/lib/cookies/project';
import type { ProjectDto } from '@/lib/schema/project';
import { cn } from '@/lib/utils';

type ProjectItemProps = {
    project: ProjectDto;
    href?: string;
    isSelected?: boolean;
    onNavigate?: () => void;
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
    const [deleteOpen, setDeleteOpen] = useState(false);
    const { trigger: updateProject, isMutating: isUpdating } = useUpdateProject(project.id);
    const { trigger: deleteProject, isMutating: isDeleting } = useDeleteProject(project.id);
    const createdDate = project.created_at ? new Date(project.created_at) : null;
    const formattedDate = createdDate ? format(createdDate, 'MMM d, yyyy') : null;
    const isArchived = Boolean(project.archived_at);
    const archivedDate = project.archived_at ? new Date(project.archived_at) : null;
    const formattedArchivedDate = archivedDate ? format(archivedDate, 'MMM d, yyyy') : null;
    const isBusy = isUpdating || isDeleting;

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

    const handleDelete = async () => {
        try {
            clearProjectCookieIfNeeded(user?.id, project.id);
            await deleteProject();
            setDeleteOpen(false);
            toast({ title: `"${project.name}" deleted` });
        } catch (error) {
            console.error('Failed to delete project:', error);
            toast({ title: 'Failed to delete project', variant: 'destructive' });
        }
    };

    const content = (
        <>
            <div className="mb-1.5 flex items-center gap-2">
                <div className="line-clamp-1 text-sm md:text-md font-medium">{project.name}</div>
                {isArchived && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-200 uppercase">
                        Archived
                    </span>
                )}
            </div>
            <div className="mb-3 line-clamp-2 text-xs text-neutral-500 md:text-sm">
                {project.description || <span className="text-neutral-600">No description</span>}
            </div>
            {(formattedArchivedDate || formattedDate) && (
                <div className="mt-0.5 text-xs text-neutral-500">
                    {isArchived ? 'Archived' : 'Created'} {isArchived ? formattedArchivedDate : formattedDate}
                </div>
            )}
        </>
    );

    return (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <div
                className={cn(
                    'flex items-start gap-3 rounded-2 border p-3.5 md:rounded-3 md:p-5',
                    isSelected ? 'border-neutral-500/30 bg-neutral-900' : 'border-border',
                    isArchived && 'border-dashed',
                )}
            >
                {href ? (
                    <Link
                        href={href}
                        onNavigate={onNavigate}
                        className="min-w-0 flex-1 rounded-lg transition-colors hover:bg-accent/50"
                    >
                        {content}
                    </Link>
                ) : (
                    <div className="min-w-0 flex-1">{content}</div>
                )}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" disabled={isBusy} className="mt-0.5 text-neutral-400">
                            {isBusy ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <MoreHorizontal className="size-4" />
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            onSelect={(event) => {
                                event.preventDefault();
                                void handleArchiveToggle();
                            }}
                        >
                            {isArchived ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
                            {isArchived ? 'Restore project' : 'Archive project'}
                        </DropdownMenuItem>
                        {isArchived && (
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={(event) => {
                                    event.preventDefault();
                                    setDeleteOpen(true);
                                }}
                            >
                                <Trash2 className="size-4" />
                                Delete project
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <AlertDialogContent onCloseAutoFocus={(event) => event.preventDefault()}>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete project</AlertDialogTitle>
                    <AlertDialogDescription>
                        Permanently delete <strong>{project.name}</strong>? This removes the project and its related
                        chats, artifacts, and derived data.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        className={buttonVariants({ variant: 'destructive' })}
                        onClick={(event) => {
                            event.preventDefault();
                            void handleDelete();
                        }}
                    >
                        {isDeleting ? <Loader2 className="size-4 animate-spin" /> : 'Delete'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export const ProjectItemSkeleton = () => {
    return (
        <div className="flex flex-col gap-2 rounded-2 p-3.5 md:rounded-3 md:p-5 border">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-24" />
        </div>
    );
};
