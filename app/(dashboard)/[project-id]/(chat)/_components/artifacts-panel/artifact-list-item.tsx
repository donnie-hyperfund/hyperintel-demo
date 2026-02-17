import { formatDistanceToNow } from 'date-fns';
import { FileText } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { VersionStatusBadge } from '../version-status-badge';

type ArtifactListItemProps = {
    artifact: ArtifactDto;
    onClick: () => void;
};

export function ArtifactListItem({ artifact, onClick }: ArtifactListItemProps) {
    const updatedAt = artifact.updated_at ? new Date(artifact.updated_at) : null;
    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : null;
    const status = (artifact.proposed_version ?? artifact.current_version)?.status;
    const isUploaded = (artifact.proposed_version ?? artifact.current_version)?.is_uploaded;

    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
        >
            <div className="flex gap-3 items-center">
                <FileText className="size-5 shrink-0 text-neutral-500 mt-0.5" />
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="line-clamp-1 text-sm font-medium">{artifact.title}</span>
                        <VersionStatusBadge status={status} isUploaded={isUploaded} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
                        <span>v{artifact.version}</span>
                        {timeAgo && (
                            <>
                                <span>·</span>
                                <span>{timeAgo}</span>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </button>
    );
}

export function ArtifactListItemSkeleton() {
    return (
        <div className="space-y-2 rounded-lg border p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
        </div>
    );
}
