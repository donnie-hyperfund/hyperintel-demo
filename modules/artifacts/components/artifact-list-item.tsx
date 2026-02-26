import { cva } from 'class-variance-authority';
import { format, formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import type { LucideIcon } from 'lucide-react';
import { Lock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { VersionStatusBadge } from '@/components/ui/version-status-badge';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';
import { getArtifactVersion, getDocumentTypeIcon } from '@/modules/artifacts/utils';

const containerVariants = cva('flex w-full items-center text-left transition-colors border', {
    variants: {
        size: {
            md: 'gap-5 rounded-3 p-5',
            sm: 'gap-3.5 rounded-2 px-3.5 py-3',
        },
    },
    defaultVariants: { size: 'md' },
});

const iconSizeVariants = cva('shrink-0 text-neutral-500', {
    variants: {
        size: {
            md: 'size-5.5',
            sm: 'size-5 mt-0.5',
        },
    },
    defaultVariants: { size: 'md' },
});

const skeletonVariants = cva('flex items-center border', {
    variants: {
        size: {
            md: 'gap-5 rounded-xl p-5',
            sm: 'rounded-lg p-3',
        },
    },
    defaultVariants: { size: 'md' },
});

type ArtifactListItemProps = {
    artifact: ArtifactDto;
    size?: 'sm' | 'md';
    icon?: LucideIcon;
    isSelected?: boolean;
    shouldDisplayVersionInfo?: boolean;
    onClick?: () => void;
};

export const ArtifactListItem = ({
    artifact,
    size = 'md',
    icon,
    isSelected,
    shouldDisplayVersionInfo = true,
    onClick,
}: ArtifactListItemProps) => {
    const artifactVersion = getArtifactVersion(artifact);
    const Icon = icon ?? getDocumentTypeIcon(artifactVersion?.document_type);

    return (
        <button
            type="button"
            onClick={onClick}
            title={artifact.title}
            className={cn(
                containerVariants({ size }),
                isSelected ? 'bg-neutral-900 border-neutral-500/30' : 'border-border',
                typeof onClick === 'function' && 'cursor-pointer hover:bg-accent/50',
            )}
        >
            <Icon className={iconSizeVariants({ size })} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="line-clamp-1 text-sm font-medium">{artifact.title}</span>
                    {shouldDisplayVersionInfo && (
                        <VersionStatusBadge
                            status={artifactVersion?.status}
                            isUploaded={artifactVersion?.is_uploaded}
                        />
                    )}
                </div>

                {shouldDisplayVersionInfo ? (
                    <VersionMeta artifact={artifact} />
                ) : (
                    <DateMeta createdAt={artifact.created_at} />
                )}
            </div>
        </button>
    );
};

function VersionMeta({ artifact }: { artifact: ArtifactDto }) {
    const artifactVersion = getArtifactVersion(artifact);
    const updatedAt = artifact.updated_at ? new Date(artifact.updated_at) : null;
    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : null;
    const updatedAtFormatted = updatedAt ? format(updatedAt, 'PPP HH:mm', { locale: enUS }) : undefined;
    const isInternal = artifactVersion?.is_internal === true;

    return (
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
    );
}

function DateMeta({ createdAt }: { createdAt: string | Date }) {
    const createdDate = createdAt ? new Date(createdAt) : null;
    const formattedDate = createdDate ? format(createdDate, 'MMM d, yyyy') : null;

    return (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
            <span>{formattedDate ?? '-'}</span>
        </div>
    );
}

export const ArtifactItemSkeleton = ({ size = 'md' }: { size?: 'sm' | 'md' }) => {
    return (
        <div className={skeletonVariants({ size })}>
            {size === 'md' && <Skeleton className="size-6 shrink-0 rounded" />}
            <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className={size === 'md' ? 'h-3 w-1/3' : 'h-3 w-1/2'} />
            </div>
        </div>
    );
};
