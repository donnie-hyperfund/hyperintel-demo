import { format } from 'date-fns';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
        <Link href={href} className="block" onNavigate={onNavigate}>
            <Card
                className={cn(
                    'cursor-pointer transition-colors hover:bg-neutral-400/8',
                    isSelected ? 'bg-neutral-900 border-neutral-500/30' : 'border-border',
                )}
            >
                <CardHeader className="mb-1 gap-2">
                    <div className="line-clamp-1 text-base font-semibold leading-none">{project.name}</div>
                    <div className="line-clamp-2 text-sm text-neutral-500">
                        {project.description || <span className="text-neutral-600">No description</span>}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="text-xs text-neutral-500">
                        {formattedDate && <span>Created {formattedDate}</span>}
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
};

export const ProjectItemSkeleton = () => {
    return (
        <Card>
            <CardHeader className="mb-1 gap-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
            </CardHeader>
            <CardContent>
                <Skeleton className="h-3 w-24" />
            </CardContent>
        </Card>
    );
};
