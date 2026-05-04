'use client';

import { Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchArtifact } from '@/lib/api/client/hooks/use-artifacts';
import { getLatestArtifactVersion } from '@/modules/artifacts/utils';
import { FilePreviewHeader } from './file-preview-header';
import { FilePreviewPanelContent } from './file-preview-panel-content';

type FilePreviewPanelProps = {
    artifactId: string;
    version: number;
    onClose: () => void;
};

export function FilePreviewPanel({ artifactId, onClose }: FilePreviewPanelProps) {
    const { data: artifact, isLoading, error } = useFetchArtifact(artifactId);

    if (isLoading) {
        return (
            <div className="flex flex-col h-full bg-neutral-975">
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
            </div>
        );
    }

    if (error || !artifact) {
        return (
            <div className="flex flex-col h-full bg-neutral-975">
                <FilePreviewHeader title="Error" onClose={onClose} />
                <div className="flex-1 flex items-center justify-center">
                    <EmptyState title="Failed to load" description={error?.message ?? 'Unknown error'} />
                </div>
            </div>
        );
    }

    const version = getLatestArtifactVersion(artifact);
    const title = version?.title ?? artifact.key ?? 'Untitled';

    return (
        <div className="flex flex-col h-full bg-neutral-975">
            <FilePreviewHeader title={title} documentType={version?.documentType} onClose={onClose} />
            <div className="flex-1 min-h-0">
                <FilePreviewPanelContent file={version?.file} content={version?.content} />
            </div>
        </div>
    );
}
