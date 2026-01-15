'use client';

import { format } from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ProjectDto } from '@/lib/schema/project';
import { cn } from '@/lib/utils';

type ProjectCardProps = {
    project: ProjectDto;
    onClick?: () => void;
    className?: string;
};

export const ProjectCard = ({ project, onClick, className }: ProjectCardProps) => {
    const createdDate = project.created_at ? new Date(project.created_at) : null;
    const formattedDate = createdDate ? format(createdDate, 'MMM d, yyyy') : null;

    return (
        <Card className={cn('hover:bg-accent/50 cursor-pointer transition-colors', className)} onClick={onClick}>
            <CardHeader className="mb-1 gap-2">
                <div className="line-clamp-1 text-base font-semibold leading-none">{project.name}</div>
                <div className="line-clamp-2 text-sm text-neutral-500">
                    {project.description || <span className="text-neutral-600">No description</span>}
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-xs text-neutral-500">{formattedDate && <span>Created {formattedDate}</span>}</div>
            </CardContent>
        </Card>
    );
};
