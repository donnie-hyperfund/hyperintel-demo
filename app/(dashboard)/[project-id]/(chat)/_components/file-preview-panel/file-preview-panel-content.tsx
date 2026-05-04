'use client';

import { Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useArtifactFileUrl } from '@/modules/artifacts/hooks/use-artifact-file-url';
import { FilePreview } from '@/modules/file-preview/components/file-preview';

type ArtifactFile = {
    id: string;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
    status: string;
};

type FilePreviewPanelContentProps = {
    file?: ArtifactFile | null;
    content?: string | null;
};

export function FilePreviewPanelContent({ file, content }: FilePreviewPanelContentProps) {
    const { url, isLoading, error } = useArtifactFileUrl(file?.id);

    if (file?.id && isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (file?.id && error) {
        return (
            <div className="flex h-full items-center justify-center">
                <EmptyState title="Failed to load file" description="Could not retrieve the file URL" />
            </div>
        );
    }

    const isPreviewable = !!(url || content);

    if (!isPreviewable) {
        return (
            <div className="flex h-full items-center justify-center">
                <EmptyState title="No preview available" description="This document has no previewable content" />
            </div>
        );
    }

    return (
        <FilePreview
            src={url ?? undefined}
            mimeType={file?.mimeType ?? 'text/markdown'}
            content={content ?? undefined}
            fileName={file?.originalName}
            viewportGap={24}
        />
    );
}
