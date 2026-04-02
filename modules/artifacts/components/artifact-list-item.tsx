import { cva, VariantProps } from 'class-variance-authority';
import { format, formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import type { LucideIcon } from 'lucide-react';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { VersionStatusBadge } from '@/components/ui/version-status-badge';
import { getSourceProjectName } from '@/lib/artifacts/utils';
import type { ArtifactDto } from '@/lib/schema/artifact';
import type { CamelCaseDto } from '@/lib/api/client/types';
import { cn } from '@/lib/utils';
import { getDocumentTypeIcon, getLatestArtifactVersion } from '@/modules/artifacts/utils';

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

type ArtifactListItemProps = VariantProps<typeof containerVariants> & {
    artifact: CamelCaseDto<ArtifactDto>;
    icon?: LucideIcon;
    isSelected?: boolean;
    isShared?: boolean;
    shouldDisplayVersionInfo?: boolean;
    badge?: React.ReactNode;
    href?: string;
    onClick?: () => void;
};

export const ArtifactListItem = ({
    artifact,
    size = 'md',
    icon,
    isSelected,
    isShared,
    shouldDisplayVersionInfo = true,
    badge,
    href,
    onClick,
}: ArtifactListItemProps) => {
    const artifactVersion = getLatestArtifactVersion(artifact);
    const Icon = icon ?? getDocumentTypeIcon(artifactVersion?.documentType);

    return (
        <ArtifactListItemContainer
            href={href}
            onClick={onClick}
            title={artifact.title}
            className={cn(
                containerVariants({ size }),
                isSelected ? 'bg-neutral-900 border-primary/50' : 'border-border',
                (href || onClick) && 'cursor-pointer hover:bg-accent/50',
            )}
        >
            <Icon className={iconSizeVariants({ size })} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="line-clamp-1 text-sm font-medium">{artifact.title}</span>
                    {isShared && <Badge variant="secondary">Shared</Badge>}
                    {badge}
                    {shouldDisplayVersionInfo && (
                        <VersionStatusBadge
                            status={artifactVersion?.status}
                            isUploaded={artifactVersion?.isUploaded}
                        />
                    )}
                </div>

                {shouldDisplayVersionInfo ? (
                    <ArtifactListItemVersionMeta artifact={artifact} />
                ) : (
                    <ArtifactListItemDateMeta artifact={artifact} />
                )}
            </div>
        </ArtifactListItemContainer>
    );
};

type ArtifactListItemContainerProps = {
    className: string;
    title: string;
    children: React.ReactNode;
    href?: string;
    onClick?: () => void;
};

function ArtifactListItemContainer({ children, className, title, href, onClick }: ArtifactListItemContainerProps) {
    if (href) {
        return (
            <Link href={href} title={title} className={className}>
                {children}
            </Link>
        );
    }

    if (onClick) {
        return (
            <button type="button" onClick={onClick} title={title} className={className}>
                {children}
            </button>
        );
    }

    return (
        <div title={title} className={className}>
            {children}
        </div>
    );
}

type ArtifactListItemVersionMetaProps = {
    artifact: CamelCaseDto<ArtifactDto>;
};

function ArtifactListItemVersionMeta({ artifact }: ArtifactListItemVersionMetaProps) {
    const artifactVersion = getLatestArtifactVersion(artifact);
    const updatedAt = artifact.updatedAt ? new Date(artifact.updatedAt) : null;
    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : null;
    const updatedAtFormatted = updatedAt ? format(updatedAt, 'PPP HH:mm', { locale: enUS }) : undefined;
    const isInternal = artifactVersion?.isInternal === true;

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

function ArtifactListItemDateMeta({ artifact }: { artifact: CamelCaseDto<ArtifactDto> }) {
    const createdDate = artifact.createdAt ? new Date(artifact.createdAt) : null;
    const formattedDate = createdDate ? format(createdDate, 'MMM d, yyyy') : null;
    const projectName = getSourceProjectName(artifact);

    return (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
            <span>{formattedDate ?? '-'}</span>
            {projectName && (
                <>
                    <span>·</span>
                    <span title={`Resource from "${projectName}" project.`} className="line-clamp-1">
                        {projectName}
                    </span>
                </>
            )}
        </div>
    );
}

type ArtifactListItemSkeletonProps = VariantProps<typeof skeletonVariants>;

export function ArtifactListItemSkeleton({ size = 'md' }: ArtifactListItemSkeletonProps) {
    return (
        <div className={skeletonVariants({ size })}>
            {size === 'md' && <Skeleton className="size-6 shrink-0 rounded" />}
            <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className={size === 'md' ? 'h-3 w-1/3' : 'h-3 w-1/2'} />
            </div>
        </div>
    );
}
