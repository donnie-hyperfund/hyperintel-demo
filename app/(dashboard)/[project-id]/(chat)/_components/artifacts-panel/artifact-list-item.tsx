import { format, formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { FileText, Lock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { getArtifactVersion } from '@/modules/chat/providers/artifact-provider/utils';
import { VersionStatusBadge } from '../version-status-badge';

type ArtifactListItemProps = {
    artifact: ArtifactDto;
    onClick: () => void;
};

export function ArtifactListItem({ artifact, onClick }: ArtifactListItemProps) {
    const updatedAt = artifact.updated_at ? new Date(artifact.updated_at) : null;
    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : null;
    const updatedAtFormatted = updatedAt ? format(updatedAt, 'PPP HH:mm', { locale: enUS }) : undefined;
    const artifactVersion = getArtifactVersion(artifact);
    const status = artifactVersion?.status;
    const isUploaded = artifactVersion?.is_uploaded;
    const isInternal = artifactVersion?.is_internal === true;

    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
            title={artifact.title}
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
                        {timeAgo && updatedAtFormatted && (
                            <>
                                <span>·</span>
                                <span title={updatedAtFormatted}>{timeAgo}</span>
                            </>
                        )}
                        {isInternal && (
                            <>
                                <span>·</span>
                                <span className="inline-flex items-center gap-0.5">
                                    <Lock className="size-3" />
                                    System-only
                                </span>
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
