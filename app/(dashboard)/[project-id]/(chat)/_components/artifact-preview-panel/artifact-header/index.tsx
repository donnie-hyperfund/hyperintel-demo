'use client';

import { format, formatDistanceToNow } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { ArrowLeft, EllipsisVertical, X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { VersionStatusBadge } from '@/components/ui/version-status-badge';
import { isAboveBreakpoint, useBreakpoint } from '@/hooks/use-breakpoint';
import type { DocumentType, VersionStatus } from '@/lib/schema/artifact';
import { getDocumentTypeIcon } from '@/modules/artifacts/utils';
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
    backHref?: string;
    updatedAt?: Date;
    onCloseAction?: () => void;
    /** Slot for extra action buttons (e.g. delete) rendered before the close button */
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
                    <Button variant="ghost" size="icon-sm" asChild>
                        <Link href={backHref}>
                            <ArrowLeft className="size-4" />
                        </Link>
                    </Button>
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

            <div className="flex items-center gap-1">
                {isLgViewportOrSmaller ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm">
                                <EllipsisVertical className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <ArtifactActions
                                type="menu-item"
                                title={title}
                                content={content}
                                isInternal={isInternal}
                                artifactVersionId={artifactVersionId}
                                isStreaming={isStreaming}
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
                    />
                )}

                {actions}

                {!backHref && onCloseAction && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={onCloseAction}>
                                <X className="size-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Close</TooltipContent>
                    </Tooltip>
                )}
            </div>
        </div>
    );
}
