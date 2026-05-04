'use client';

import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { ImageViewer } from './image-viewer';
import { MarkdownViewer } from './markdown-viewer';
import { UnsupportedFileInfo } from './unsupported-file-info';

const PdfViewer = dynamic(() => import('./pdf-viewer').then((m) => ({ default: m.PdfViewer })), {
    ssr: false,
    loading: () => (
        <div className="flex h-full items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
    ),
});

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
