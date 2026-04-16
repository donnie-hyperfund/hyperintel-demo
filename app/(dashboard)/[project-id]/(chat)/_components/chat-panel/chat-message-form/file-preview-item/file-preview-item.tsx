'use client';

import { Loader2, X } from 'lucide-react';
import { useImageObjectUrl } from '@/app/(dashboard)/[project-id]/(chat)/_components/chat-panel/chat-message-form/file-preview-item/use-image-object-url';
import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { formatFileSize, getFileExtension } from '@/lib/files';
import type { FileEntryStatus } from '@/modules/file-uploads/types';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

type FilePreviewItemProps = {
    name: string;
    size: number;
    status?: FileEntryStatus;
    file?: File;
    onRemove?: () => void;
};

export function FilePreviewItem({ name, size, status, file, onRemove }: FilePreviewItemProps) {
    const ext = getFileExtension(name).toLowerCase();
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const thumbUrl = useImageObjectUrl(isImage ? file : undefined);

    return (
        <div className="flex min-w-0 items-center gap-4 rounded-3 bg-neutral-700/50 px-4 py-2.5">
            {thumbUrl ? (
                <img src={thumbUrl} alt={name} className="size-8 shrink-0 rounded-1 object-cover" />
            ) : (
                <FileTypeIcon filename={name} size={24} className="shrink-0" />
            )}
            <div className="min-w-0 flex-1 flex flex-col gap-1">
                <p className="truncate text-sm leading-tight">{name}</p>
                <p className="text-muted-foreground text-xs leading-tight">
                    {ext.toUpperCase()} &middot; {formatFileSize(size)}
                </p>
            </div>

            {status === 'uploading' || status === 'processing' ? (
                <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
            ) : (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove?.();
                    }}
                    className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer transition-colors"
                >
                    <X className="size-5" />
                </button>
            )}
        </div>
    );
}
