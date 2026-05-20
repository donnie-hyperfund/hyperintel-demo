'use client';

import { format } from 'date-fns';
import { Info, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { type Ref, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { IconButton } from '@/components/ui/icon-button';
import { ImageThumbnail } from '@/components/ui/image-thumbnail';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CamelCaseDto } from '@/lib/api/client/types';
import { getArtifactDocumentType, getSourceProjectName } from '@/lib/artifacts/utils';
import { getFileExtension } from '@/lib/files';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';
import { getDocumentTypeIcon, getLatestArtifactVersion } from '@/modules/artifacts/utils';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';

const routePrefixByType: Record<string, string> = {
    'Company Profile': '/companies',
    'Human Persona': '/stakeholders',
};

function getResourceRoute(artifact: CamelCaseDto<ArtifactDto>): string | undefined {
    const docType = getArtifactDocumentType(artifact);
    const routePrefix = docType && routePrefixByType[docType];
    const sourceChatId = artifact.metadata?.sourceChatId as string | undefined;
    return routePrefix && sourceChatId ? `${routePrefix}/${sourceChatId}` : undefined;
}

export function isPublicImport(artifact: CamelCaseDto<ArtifactDto>): boolean {
    return artifact.metadata?.importedFromPublic === true;
}

type ResourceListItemProps = {
    artifact: CamelCaseDto<ArtifactDto>;
    onRemove?: (artifactId: string) => Promise<void>;
    isHighlighted?: boolean;
    itemRef?: Ref<HTMLDivElement>;
};

export function ResourceListItem({ artifact, onRemove, isHighlighted = false, itemRef }: ResourceListItemProps) {
    const [isRemoving, setIsRemoving] = useState(false);
    const { pushPanel } = useActivePanelContext();
    const version = getLatestArtifactVersion(artifact);
    const docType = getArtifactDocumentType(artifact);
    const alwaysAttached = isPublicImport(artifact);
    const href = getResourceRoute(artifact);
    const isShared = !artifact.isOwn && !!docType && docType in routePrefixByType;
    const isUploaded = version?.isUploaded === true;
    const file = (version as any)?.file as { id?: string; originalName?: string; mimeType?: string } | undefined;
    const fileName = file?.originalName ?? artifact.key;

    const handlePreview = () => {
        pushPanel({
            panel: 'file-preview',
            artifactId: artifact.id,
        });
    };

    const handleRemove = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!onRemove) return;
        setIsRemoving(true);
        try {
            await onRemove(artifact.id);
        } finally {
            setIsRemoving(false);
        }
    };

    const title = version?.title ?? '';

    return (
        <div ref={itemRef} className={cn('group relative rounded-lg', isHighlighted && 'highlight-pulse')}>
            <ResourceListItemContainer href={href} onClick={href || isShared ? undefined : handlePreview} title={title}>
                <ResourceListItemIcon isUploaded={isUploaded} fileName={fileName} documentType={docType} file={file} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="line-clamp-1 text-sm font-medium">{title}</span>
                        {isShared && (
                            <Badge variant="secondary" className="rounded px-1.5 py-0.25 text-[10px]">
                                Shared
                            </Badge>
                        )}
                        {alwaysAttached && <AlwaysAttachedBadge />}
                    </div>
                    <ResourceListItemMeta artifact={artifact} isUploaded={isUploaded} fileName={fileName} />
                </div>
            </ResourceListItemContainer>
            {alwaysAttached ? (
                <AlwaysAttachedInfo />
            ) : (
                onRemove && <RemoveButton onClick={handleRemove} disabled={isRemoving} />
            )}
        </div>
    );
}

type ResourceListItemContainerProps = {
    children: React.ReactNode;
    href?: string;
    onClick?: () => void;
    title: string;
};

function ResourceListItemContainer({ children, href, onClick, title }: ResourceListItemContainerProps) {
    const className = cn(
        'flex w-full items-center text-left transition-colors border border-border gap-3.5 rounded-2 px-3.5 py-3',
        (href || onClick) && 'cursor-pointer hover:bg-accent/50',
    );

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

type ResourceListItemIconProps = {
    isUploaded: boolean;
    fileName: string;
    documentType?: string;
    file?: { id?: string; mimeType?: string };
};

function ResourceListItemIcon({ isUploaded, fileName, documentType, file }: ResourceListItemIconProps) {
    if (isUploaded && file?.id && file.mimeType?.startsWith('image/')) {
        return <ImageThumbnail fileId={file.id} className="mt-0.5" />;
    }

    if (isUploaded) {
        return <FileTypeIcon filename={fileName} size={20} className="shrink-0 mt-0.5" />;
    }

    const Icon = getDocumentTypeIcon(documentType as any);
    return <Icon className="size-5 shrink-0 text-neutral-500 mt-0.5" />;
}

type ResourceListItemMetaProps = {
    artifact: CamelCaseDto<ArtifactDto>;
    isUploaded: boolean;
    fileName: string;
};

function ResourceListItemMeta({ artifact, isUploaded, fileName }: ResourceListItemMetaProps) {
    const createdDate = artifact.createdAt ? new Date(artifact.createdAt) : null;
    const formattedDate = createdDate ? format(createdDate, 'MMM d, yyyy') : null;
    const projectName = getSourceProjectName(artifact);
    const ext = isUploaded ? getFileExtension(fileName).toUpperCase() : null;

    return (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
            <span>{formattedDate ?? '-'}</span>
            {ext && (
                <>
                    <span>·</span>
                    <span>{ext}</span>
                </>
            )}
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

function AlwaysAttachedBadge() {
    return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0">
            Always attached
        </Badge>
    );
}

function AlwaysAttachedInfo() {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center size-7 text-neutral-500 cursor-default">
                    <Info className="size-3.5" />
                </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-52">
                Attached to every project.
            </TooltipContent>
        </Tooltip>
    );
}

function RemoveButton({ onClick, disabled }: { onClick: (e: React.MouseEvent) => void; disabled: boolean }) {
    return (
        <IconButton
            size="sm"
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 max-md:opacity-100 group-hover:opacity-100 transition-opacity hover:text-red-400"
            onClick={onClick}
            disabled={disabled}
        >
            {disabled ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </IconButton>
    );
}

export function ResourceListItemSkeleton() {
    return (
        <div className="flex items-center rounded-lg p-3">
            <div className="flex w-full items-center gap-3.5 rounded-2 px-3.5 py-3 border border-border">
                <Skeleton className="size-5 shrink-0 rounded" />
                <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                </div>
            </div>
        </div>
    );
}
