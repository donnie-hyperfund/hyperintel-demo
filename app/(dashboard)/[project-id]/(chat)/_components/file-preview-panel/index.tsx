'use client';

import { Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchArtifact } from '@/lib/api/client/hooks/use-artifacts';
import { useArtifactFileUrl } from '@/modules/artifacts/hooks/use-artifact-file-url';
import { getLatestArtifactVersion } from '@/modules/artifacts/utils';
import { FilePreviewHeader } from './file-preview-header';
import { FilePreviewPanelContent } from './file-preview-panel-content';

type FilePreviewPanelProps = {
    artifactId: string;
    version: number;
    onClose: () => void;
};

export function FilePreviewPanel({ artifactId, onClose }: FilePreviewPanelProps) {
    const { data: artifact, isLoading: isLoadingArtifact, error } = useFetchArtifact(artifactId);

    const version = artifact ? getLatestArtifactVersion(artifact) : undefined;
    const file = version?.file;
    const { url: fileUrl, isLoading: isLoadingUrl } = useArtifactFileUrl(file?.id);

    const isLoading = isLoadingArtifact || (!!file?.id && isLoadingUrl);
    const title = version?.title ?? artifact?.key ?? 'Untitled';

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
                <FilePreviewHeader title="Error" artifactId={artifactId} onClose={onClose} />
                <div className="flex-1 flex items-center justify-center">
                    <EmptyState title="Failed to load" description={error?.message ?? 'Unknown error'} />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-neutral-975">
            <FilePreviewHeader
                title={title}
                documentType={version?.documentType}
                artifactId={artifactId}
                fileName={file?.originalName}
                fileUrl={fileUrl}
                content={version?.content}
                isUploaded={version?.isUploaded}
                onClose={onClose}
            />
            <div className="flex-1 min-h-0">
                <FilePreviewPanelContent file={file} content={version?.content} />
            </div>
        </div>
    );
}
