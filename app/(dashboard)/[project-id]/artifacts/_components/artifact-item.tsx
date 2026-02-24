'use client';

import { formatDistanceToNow } from 'date-fns';
import { FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';

type ArtifactItemProps = {
    artifact: ArtifactDto;
    projectId?: string;
};

export const ArtifactItem = ({ artifact, projectId }: ArtifactItemProps) => {
    const router = useRouter();

    const updatedAt = artifact.updated_at ? new Date(artifact.updated_at) : null;
    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : null;

    const handleClick = () => {
        if (!projectId) return;
        router.push(`/${projectId}/artifacts/${artifact.id}`);
    };

    return (
        <Card className={cn('cursor-pointer transition-colors hover:bg-accent/50', 'py-4')} onClick={handleClick}>
            <CardHeader className="mb-0 gap-1 py-0">
                <div className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0 text-neutral-500" />
                    <div className="line-clamp-1 text-base font-semibold leading-tight" title={artifact.title}>{artifact.title}</div>
                </div>
            </CardHeader>
            <CardContent className="py-0 pt-1">
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <span>v{artifact.version}</span>
                    {timeAgo && (
                        <>
                            <span>·</span>
                            <span>Updated {timeAgo}</span>
                        </>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
