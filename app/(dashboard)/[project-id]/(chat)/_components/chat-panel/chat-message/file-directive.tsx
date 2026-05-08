'use client';

import type { DirectiveHandler } from '@/components/ui/markdown-renderer';
import { FileThumbnail } from './file-thumbnail';
import { ImageThumbnail } from './image-thumbnail';

export const UploadDirective: DirectiveHandler = ({ label, attributes }) => {
    const size = Number(attributes.size);
    const fileId = attributes.fileid || attributes['file-id'];
    const artifactFileId = attributes.artifactfileid || attributes['artifact-file-id'];
    const artifactId = attributes.artifactid || attributes['artifact-id'];
    const isImage = attributes.type === 'image' && (fileId || artifactFileId);

    if (isImage) {
        const width = Number(attributes.w) || undefined;
        const height = Number(attributes.h) || undefined;
        return (
            <ImageThumbnail
                label={label}
                fileId={fileId}
                artifactFileId={artifactFileId}
                artifactId={artifactId}
                size={size}
                width={width}
                height={height}
            />
        );
    }

    return <FileThumbnail label={label} size={size} artifactId={artifactId} />;
};
