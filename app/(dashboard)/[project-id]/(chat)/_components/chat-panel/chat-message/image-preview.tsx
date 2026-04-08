'use client';

import { ZoomIn } from 'lucide-react';
import { useState } from 'react';
import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { ImageLightbox, ImageLightboxContent, ImageLightboxTrigger } from '@/components/ui/image-lightbox';
import { formatFileSize } from '@/lib/files';

const MAX_PREVIEW_W = 288;
const MAX_PREVIEW_H = 288;

function getPreviewDimensions(w?: number, h?: number) {
    if (!w || !h) return undefined;
    const scale = Math.min(1, MAX_PREVIEW_W / w, MAX_PREVIEW_H / h);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

type ImagePreviewProps = {
    label: string;
    fileId: string;
    size: number;
    width?: number;
    height?: number;
};

export function ImagePreview({ label, fileId, size, width, height }: ImagePreviewProps) {
    const [failed, setFailed] = useState(false);
    const src = `/api/chat/images/${fileId}`;
    const dims = getPreviewDimensions(width, height);

    if (failed) {
        return (
            <div className="mb-2 max-w-128">
                <div className="flex items-center gap-3 rounded-3 bg-neutral-700/40 p-2">
                    <FileTypeIcon filename={label} size={28} className="mb-0! mt-0!" />
                    <span className="truncate text-sm">{label}</span>
                    {size > 0 && <span className="text-muted-foreground shrink-0 text-xs">{formatFileSize(size)}</span>}
                </div>
            </div>
        );
    }

    return (
        <div className="mb-2 max-w-72 pt-1">
            <ImageLightbox>
                <ImageLightboxTrigger asChild>
                    <button
                        type="button"
                        className="group/img relative cursor-pointer rounded-3 bg-neutral-700/40 focus:outline-none"
                        style={dims ? { width: dims.width, height: dims.height } : undefined}
                    >
                        <img
                            src={src}
                            alt={label}
                            className="m-0! min-h-6 min-w-6 rounded-3 max-h-72 w-auto object-contain"
                            onError={() => setFailed(true)}
                        />
                        <div className="absolute inset-0 flex items-center justify-center rounded-3 bg-black/0 transition-colors group-hover/img:bg-black/40">
                            <ZoomIn className="size-6 text-neutral-200 opacity-0 drop-shadow-lg transition-opacity group-hover/img:opacity-100" />
                        </div>
                    </button>
                </ImageLightboxTrigger>
                <ImageLightboxContent src={src} alt={label} />
            </ImageLightbox>
            <div className="mt-1 flex items-center gap-2 px-1 max-w-56">
                <span className="text-muted-foreground truncate text-xs">{label}</span>
                {size > 0 && <span className="text-muted-foreground shrink-0 text-xs">{formatFileSize(size)}</span>}
            </div>
        </div>
    );
}
