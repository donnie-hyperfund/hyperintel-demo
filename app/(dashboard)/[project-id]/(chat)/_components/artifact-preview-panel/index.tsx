'use client';

import { FileText, Loader2 } from 'lucide-react';
import { useArtifact } from '@/modules/artifacts/providers/artifact-provider';
import { getLatestArtifactContent, getLatestArtifactVersion } from '@/modules/artifacts/utils';
import { ArtifactViewer } from './artifact-viewer';

type ArtifactPreviewPanelProps = {
    version: number;
    artifactId: string;
    onClose: () => void;
};

export const ArtifactPreviewPanel = ({ version, artifactId, onClose }: ArtifactPreviewPanelProps) => {
    const currentArtifact = useArtifact(artifactId, version);

    const { isLoading, isStreaming } = currentArtifact ?? {};

    const content = currentArtifact ? getLatestArtifactContent(currentArtifact) : '';
    const activeVersion = currentArtifact ? getLatestArtifactVersion(currentArtifact) : undefined;
    const isInternal = activeVersion?.isInternal;

    const pecpContent = currentArtifact?.pecpContent ?? currentArtifact?.pecp?.content ?? '';
    const showSkeleton = (isLoading || (isStreaming && (!isInternal || !pecpContent))) && !content;

    if (showSkeleton) {
        return (
            <div className="flex flex-col h-full bg-neutral-975 animate-in fade-in duration-300">
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <div className="text-center space-y-4">
                        <Loader2 className="size-12 mx-auto animate-spin text-primary" />
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">
                                {currentArtifact?.title ?? 'Loading document...'}
                            </p>
                            <p className="text-xs text-muted-foreground">Fetching content</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!currentArtifact) {
        return (
            <div className="flex flex-col h-full bg-neutral-975 animate-in fade-in duration-300">
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <div className="text-center space-y-2">
                        <FileText className="size-12 mx-auto opacity-50" />
                        <p className="text-sm">Select a document to preview</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full animate-in fade-in slide-in-from-right-4 duration-300">
            <ArtifactViewer artifact={currentArtifact} version={version} onCloseAction={onClose} />
        </div>
    );
};
