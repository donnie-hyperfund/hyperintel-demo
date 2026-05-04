'use client';

import { ImageViewer } from './image-viewer';
import { MarkdownViewer } from './markdown-viewer';
import { PdfViewer } from './pdf-viewer';
import { UnsupportedFileInfo } from './unsupported-file-info';

type FilePreviewProps = {
    /** URL for PDF or image content */
    src?: string;
    /** MIME type — determines which viewer renders */
    mimeType: string;
    /** Text content for markdown rendering */
    content?: string;
    /** Gap around the content in pixels */
    viewportGap?: number;
    /** Original filename — used for download */
    fileName?: string;
};

export function FilePreview({ src, mimeType, content, viewportGap, fileName }: FilePreviewProps) {
    if (mimeType === 'application/pdf' && src) {
        return <PdfViewer src={src} viewportGap={viewportGap} />;
    }

    if (mimeType.startsWith('image/') && src) {
        return <ImageViewer src={src} viewportGap={viewportGap} />;
    }

    if (mimeType === 'text/markdown') {
        return <MarkdownViewer content={content ?? ''} viewportGap={viewportGap} />;
    }

    return <UnsupportedFileInfo src={src} fileName={fileName} />;
}
