import { format } from 'date-fns';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProjectDto } from '@/lib/schema/project';
import { cn } from '@/lib/utils';

type ProjectItemProps = {
    project: ProjectDto;
    href: string;
    isSelected?: boolean;
    onNavigate?: () => void;
};

export const ProjectItem = ({ project, href, isSelected, onNavigate }: ProjectItemProps) => {
    const createdDate = project.created_at ? new Date(project.created_at) : null;
    const formattedDate = createdDate ? format(createdDate, 'MMM d, yyyy') : null;

    return (
        <Link
            href={href}
            onNavigate={onNavigate}
            className={cn(
                'flex flex-col rounded-2 p-3.5 md:rounded-3 md:p-5 border transition-colors',
                isSelected ? 'bg-neutral-900 border-neutral-500/30' : 'border-border',
                'cursor-pointer hover:bg-accent/50',
            )}
        >
            <div className="line-clamp-1 text-sm md:text-md font-medium mb-1.5">{project.name}</div>
            <div className="line-clamp-2 text-xs md:text-sm text-neutral-500 mb-3">
                {project.description || <span className="text-neutral-600">No description</span>}
            </div>
            {formattedDate && <div className="text-xs text-neutral-500 mt-0.5">Created {formattedDate}</div>}
        </Link>
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
