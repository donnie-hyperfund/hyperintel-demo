import { FileText, Loader2 } from 'lucide-react';
import { formatFileSize, getFileExtension } from '@/lib/files';
import type { FileEntryStatus } from '@/modules/file-uploads/providers/file-upload-provider';

type UploadingResourceItemProps = {
    name: string;
    size: number;
    status: FileEntryStatus;
};

export function UploadingResourceItem({ name, size, status }: UploadingResourceItemProps) {
    return (
        <div className="group relative rounded-lg border-l-2 border-l-transparent">
            <div className="flex w-full items-center text-left transition-colors border border-border gap-3.5 rounded-2 px-3.5 py-3 animate-pulse">
                <FileText className="size-5 mt-0.5 shrink-0 text-neutral-500" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="line-clamp-1 text-sm font-medium">{name}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
                        <span>{getFileExtension(name).toUpperCase()}</span>
                        <span>&middot;</span>
                        <span>{formatFileSize(size)}</span>
                        <span>&middot;</span>
                        <span className="capitalize">{status === 'ready' ? 'Finishing up' : `${status}…`}</span>
                    </div>
                </div>
                <Loader2 className="size-4 shrink-0 animate-spin text-neutral-500" />
            </div>
        </div>
    );
}
