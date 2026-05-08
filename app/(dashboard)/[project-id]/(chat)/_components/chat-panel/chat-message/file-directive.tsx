'use client';

import { FileTypeIcon } from '@/components/ui/file-type-icon';
import type { DirectiveHandler } from '@/components/ui/markdown-renderer';
import { formatFileSize } from '@/lib/files';
import { ImagePreview } from './image-preview';

export const UploadDirective: DirectiveHandler = ({ label, attributes }) => {
    const size = Number(attributes.size);
    const fileId = attributes.fileid || attributes['file-id'];
    const artifactFileId = attributes.artifactfileid || attributes['artifact-file-id'];
    const isImage = attributes.type === 'image' && (fileId || artifactFileId);

    if (isImage) {
        const width = Number(attributes.w) || undefined;
        const height = Number(attributes.h) || undefined;
        return (
            <ImagePreview
                label={label}
                fileId={fileId}
                artifactFileId={artifactFileId}
                size={size}
                width={width}
                height={height}
            />
        );
    }

    return (
        <div className="mb-2 max-w-128">
            <div className="flex items-center gap-3 rounded-3 bg-neutral-700/40 p-2">
                <FileTypeIcon filename={label} size={28} className="mb-0! mt-0!" />
                <span className="truncate text-sm">{label}</span>
                {size > 0 && <span className="text-muted-foreground shrink-0 text-xs">{formatFileSize(size)}</span>}
            </div>
        </div>
    );
};
