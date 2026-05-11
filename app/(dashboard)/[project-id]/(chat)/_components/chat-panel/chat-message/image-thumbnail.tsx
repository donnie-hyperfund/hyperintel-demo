'use client';

import { Loader2, ZoomIn } from 'lucide-react';
import { useState } from 'react';
import { getImageUrl } from '@/lib/api/requests/worker/chat';
import { formatFileSize, getImageMimeType } from '@/lib/files';
import { useArtifactFileUrl } from '@/modules/artifacts/hooks/use-artifact-file-url';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { FileThumbnail } from './file-thumbnail';

const MAX_PREVIEW_W = 288;
const MAX_PREVIEW_H = 288;

function getPreviewDimensions(w?: number, h?: number) {
    if (!w || !h) return undefined;
    const scale = Math.min(1, MAX_PREVIEW_W / w, MAX_PREVIEW_H / h);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

type ImageThumbnailProps = {
    label: string;
    fileId?: string;
    artifactFileId?: string;
    artifactId?: string;
    size: number;
    width?: number;
    height?: number;
};

export function ImageThumbnail({ label, fileId, artifactFileId, artifactId, size, width, height }: ImageThumbnailProps) {
    const [failed, setFailed] = useState(false);
    const { url: artifactUrl, isLoading: isLoadingArtifact } = useArtifactFileUrl(artifactFileId);
    const { pushPanel } = useActivePanelContext();
    const src = fileId ? getImageUrl(fileId) : artifactUrl;
    const isLoading = !fileId && isLoadingArtifact;
    const dims = getPreviewDimensions(width, height);

    const handleClick = () => {
        if (artifactId) {
            pushPanel({ panel: 'file-preview', artifactId }, { reset: true });
        } else if (src) {
            pushPanel({ panel: 'file-preview', fileUrl: src, fileName: label, mimeType: getImageMimeType(label) }, { reset: true });
        }
    };

    const isClickable = !!(artifactId || src);

    if (isLoading) {
        return (
            <div className="mb-2 max-w-72 pt-1">
                <div
                    className="flex items-center justify-center rounded-3 bg-neutral-700/40"
                    style={dims ? { width: dims.width, height: dims.height } : { width: 128, height: 128 }}
                >
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
                <div className="mt-1 flex items-center gap-2 px-1 max-w-56">
                    <span className="text-muted-foreground truncate text-xs">{label}</span>
                    {size > 0 && <span className="text-muted-foreground shrink-0 text-xs">{formatFileSize(size)}</span>}
                </div>
            </div>
        );
    }

    if (failed) {
        return <FileThumbnail label={label} size={size} artifactId={artifactId} />;
    }

    return (
        <div className="mb-2 max-w-72 pt-1">
            <button
                type="button"
                onClick={handleClick}
                className="group/img relative rounded-3 bg-neutral-700/40 focus:outline-none"
                style={dims ? { width: dims.width, height: dims.height } : undefined}
                disabled={!isClickable}
            >
                <img
                    src={src ?? undefined}
                    alt={label}
                    className="m-0! min-h-6 min-w-6 rounded-3 max-h-72 w-auto object-contain"
                    onError={() => setFailed(true)}
                />
                {isClickable && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-3 bg-black/0 transition-colors group-hover/img:bg-black/40 cursor-pointer">
                        <ZoomIn className="size-6 text-neutral-200 opacity-0 drop-shadow-lg transition-opacity group-hover/img:opacity-100" />
                    </div>
                )}
            </button>
            <div className="mt-1 flex items-center gap-2 px-1 max-w-56">
                <span className="text-muted-foreground truncate text-xs">{label}</span>
                {size > 0 && <span className="text-muted-foreground shrink-0 text-xs">{formatFileSize(size)}</span>}
            </div>
        </div>
    );
}
