'use client';

import { Download, Loader2, Trash2, X } from 'lucide-react';
import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DocumentType } from '@/lib/schema/artifact';
import { getDocumentTypeIcon } from '@/modules/artifacts/utils';

type FilePreviewHeaderProps = {
    title: string;
    documentType?: DocumentType;
    fileName?: string;
    onClose: () => void;
    onDownload?: () => void;
    onDelete?: () => void;
    isDeleting?: boolean;
};

export function FilePreviewHeader({
    title,
    documentType,
    fileName,
    onClose,
    onDownload,
    onDelete,
    isDeleting,
}: FilePreviewHeaderProps) {
    return (
        <div className="flex items-center justify-between gap-2 h-14 px-4 border-b border-border">
            <div className="flex items-center gap-3 min-w-0">
                <HeaderIcon fileName={fileName} documentType={documentType} />
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

type HeaderIconProps = {
    fileName?: string;
    documentType?: DocumentType;
};

function HeaderIcon({ fileName, documentType }: HeaderIconProps) {
    if (fileName) {
        return <FileTypeIcon filename={fileName} size={20} className="shrink-0" />;
    }

    const Icon = getDocumentTypeIcon(documentType);
    return <Icon className="size-5 shrink-0 text-neutral-500" />;
}
