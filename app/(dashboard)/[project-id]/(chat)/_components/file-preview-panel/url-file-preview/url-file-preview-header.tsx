'use client';

import { X } from 'lucide-react';
import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { IconButton } from '@/components/ui/icon-button';

type UrlFilePreviewHeaderProps = {
    fileName: string;
    onClose: () => void;
};

export function UrlFilePreviewHeader({ fileName, onClose }: UrlFilePreviewHeaderProps) {
    return (
        <div className="flex items-center justify-between gap-2 h-14 px-4 border-b border-border">
            <div className="flex items-center gap-3 min-w-0">
                <FileTypeIcon filename={fileName} size={20} className="shrink-0" />
                <span title={fileName} className="line-clamp-1 text-sm font-medium">
                    {fileName}
                </span>
            </div>
            <IconButton size="sm" onClick={onClose}>
                <X />
            </IconButton>
        </div>
    );
}
