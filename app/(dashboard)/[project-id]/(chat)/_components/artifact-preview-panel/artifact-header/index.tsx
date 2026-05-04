'use client';

import { format, formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { ArrowLeft, EllipsisVertical, X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { VersionStatusBadge } from '@/components/ui/version-status-badge';
import { isAboveBreakpoint, useBreakpoint } from '@/hooks/use-breakpoint';
import type { DocumentType, VersionStatus } from '@/lib/schema/artifact';
import { getDocumentTypeIcon } from '@/modules/artifacts/utils';
import type { Artifact } from '@/modules/chat/types';
import { ArtifactActions } from './artifact-actions';

type ArtifactHeaderProps = {
    title: string;
    content: string;
    version?: number;
    status?: VersionStatus;
    documentType?: DocumentType;
    isUploaded?: boolean;
    isInternal?: boolean;
    artifactVersionId?: string;
    artifact?: Artifact;
    backHref?: string;
    updatedAt?: Date;
    onCloseAction?: () => void;
    /** Slot for extra action buttons (e.g. version history, delete) rendered before the close button */
    actions?: ReactNode;
    /** Whether the content is being streamed */
    isStreaming?: boolean;
};

export function ArtifactHeader({
    title,
    content,
    version,
    status,
    documentType,
    isUploaded,
    isInternal,
    artifactVersionId,
    artifact,
    backHref,
    updatedAt,
    onCloseAction,
    actions,
    isStreaming,
}: ArtifactHeaderProps) {
    const Icon = getDocumentTypeIcon(documentType);
    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : undefined;
    const updatedAtFormatted = updatedAt ? format(updatedAt, 'PPP HH:mm', { locale: enUS }) : undefined;
    const { breakpoint } = useBreakpoint();
    const isLgViewportOrSmaller = !isAboveBreakpoint(breakpoint, 'lg');

    return (
        <div className="flex items-center justify-between gap-2 h-14 px-4 border-b border-border">
            <div className="flex items-center gap-2.5 min-w-0">
                {backHref && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <IconButton size="sm" asChild>
                                <Link href={backHref}>
                                    <ArrowLeft />
                                </Link>
                            </IconButton>
                        </TooltipTrigger>
                        <TooltipContent>Back</TooltipContent>
                    </Tooltip>
                )}
                <div className="flex gap-3 items-center">
                    <Icon className="size-5 shrink-0 text-neutral-500 mt-0.5" />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span title={title} className="line-clamp-1 text-sm font-medium">
                                {title}
                            </span>
                            <VersionStatusBadge status={status} isUploaded={isUploaded} />
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
                            <span>v{version}</span>
                            {timeAgo && updatedAtFormatted && (
                                <>
                                    <span>·</span>
                                    <span title={updatedAtFormatted}>{timeAgo}</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-0.5">
                {isLgViewportOrSmaller ? (
                    <DropdownMenu>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                    <IconButton size="sm">
                                        <EllipsisVertical />
                                    </IconButton>
                                </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent>Actions</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="end">
                            <ArtifactActions
                                type="menu-item"
                                title={title}
                                content={content}
                                isInternal={isInternal}
                                artifactVersionId={artifactVersionId}
                                isStreaming={isStreaming}
                                artifact={artifact}
                                version={version}
                            />
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <ArtifactActions
                        type="button"
                        title={title}
                        content={content}
                        isInternal={isInternal}
                        artifactVersionId={artifactVersionId}
                        isStreaming={isStreaming}
                        artifact={artifact}
                        version={version}
                    />
                )}

                {actions}

                {!backHref && onCloseAction && (
                    <IconButton size="sm" onClick={onCloseAction}>
                        <X />
                    </IconButton>
                )}
            </div>
        </div>
    );
}
