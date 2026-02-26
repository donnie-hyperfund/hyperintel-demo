import { format } from 'date-fns';
import type { LucideIcon } from 'lucide-react';
import { FileText } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';

type ArtifactItemProps = {
    artifact: ArtifactDto;
    icon?: LucideIcon;
    isSelected?: boolean;
    onClick: () => void;
};

export const ArtifactItem = ({ artifact, icon: Icon = FileText, isSelected, onClick }: ArtifactItemProps) => {
    const createdDate = artifact.created_at ? new Date(artifact.created_at) : null;
    const formattedDate = createdDate ? format(createdDate, 'MMM d, yyyy') : null;

    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex w-full items-center gap-5 rounded-xl border p-5 text-left transition-colors hover:bg-accent/50',
                isSelected ? 'bg-neutral-900 border-neutral-500/30' : 'border-border',
            )}
        >
            <Icon className="size-5.5 shrink-0 text-neutral-500" />
            <div className="min-w-0 flex-1">
                <span className="line-clamp-1 text-sm font-medium" title={artifact.title}>{artifact.title}</span>

                <div className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
                    <span>{formattedDate ?? '-'}</span>
                </div>
            </div>
        </button>
    );
};

export const ArtifactItemSkeleton = () => {
    return (
        <div className="flex items-center gap-5 rounded-xl border p-5">
            <Skeleton className="size-6 shrink-0 rounded" />
            <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
            </div>
        </div>
    );
};
