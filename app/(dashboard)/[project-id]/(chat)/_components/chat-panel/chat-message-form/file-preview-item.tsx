import { Loader2, X } from 'lucide-react';
import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { formatFileSize, getFileExtension } from '@/lib/files';
import type { FileEntryStatus } from '@/modules/file-uploads/providers/file-upload-provider';

type FilePreviewItemProps = {
    file: File;
    status?: FileEntryStatus;
    onRemove?: () => void;
};

export function FilePreviewItem({ file, status, onRemove }: FilePreviewItemProps) {
    return (
        <div className="flex min-w-0 items-center gap-4 rounded-3 bg-neutral-700/50 px-4 py-2.5">
            <FileTypeIcon filename={file.name} size={24} className="shrink-0" />
            <div className="min-w-0 flex-1 flex flex-col gap-1">
                <p className="truncate text-sm leading-tight">{file.name}</p>
                <p className="text-muted-foreground text-xs leading-tight">
                    {getFileExtension(file.name).toUpperCase()} &middot; {formatFileSize(file.size)}
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
