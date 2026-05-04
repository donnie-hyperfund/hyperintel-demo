'use client';

import { Download, Loader2, Trash2, X } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DocumentType } from '@/lib/schema/artifact';
import { getDocumentTypeIcon } from '@/modules/artifacts/utils';

type FilePreviewHeaderProps = {
    title: string;
    documentType?: DocumentType;
    onClose: () => void;
    onDownload?: () => void;
    onDelete?: () => void;
    isDeleting?: boolean;
};

export function FilePreviewHeader({
    title,
    documentType,
    onClose,
    onDownload,
    onDelete,
    isDeleting,
}: FilePreviewHeaderProps) {
    const Icon = getDocumentTypeIcon(documentType);

    return (
        <div className="flex items-center justify-between gap-2 h-14 px-4 border-b border-border">
            <div className="flex items-center gap-3 min-w-0">
                <Icon className="size-5 shrink-0 text-neutral-500" />
                <span title={title} className="line-clamp-1 text-sm font-medium">
                    {title}
                </span>
            </div>

            <div className="flex items-center gap-0.5">
                {onDownload && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <IconButton size="sm" onClick={onDownload}>
                                <Download />
                            </IconButton>
                        </TooltipTrigger>
                        <TooltipContent>Download</TooltipContent>
                    </Tooltip>
                )}
                {onDelete && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <IconButton size="sm" onClick={onDelete} disabled={isDeleting}>
                                {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                            </IconButton>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                )}
                <IconButton size="sm" onClick={onClose}>
                    <X />
                </IconButton>
            </div>
        </div>
    );
}
