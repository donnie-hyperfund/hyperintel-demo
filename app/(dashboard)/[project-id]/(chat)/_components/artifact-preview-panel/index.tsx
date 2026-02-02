'use client';

import { FileText, Loader2 } from 'lucide-react';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import { getActiveVersion, getArtifactContent } from '@/modules/chat/types';
import { ArtifactViewer } from './artifact-viewer';

export default function ArtifactPreviewPanel() {
    const { panelState, closePanel } = useActivePanelContext();
    const { artifacts } = useArtifactContext();

    const artifactId = panelState?.panel === 'artifact-preview' ? panelState.artifactId : null;
    const currentArtifact = artifactId ? (artifacts[artifactId] ?? null) : null;

    const updatedAt = currentArtifact?.updated_at ? new Date(currentArtifact.updated_at) : undefined;
    const isLoading = currentArtifact?.isLoading;
    const isStreaming = currentArtifact?.isStreaming;
    const isUpdating = currentArtifact?.isUpdating;
    const content = currentArtifact ? getArtifactContent(currentArtifact) : '';
    const activeVersion = currentArtifact ? getActiveVersion(currentArtifact) : undefined;
    const showSkeleton = (isLoading || isStreaming) && !content;

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
            <ArtifactViewer
                title={currentArtifact.title}
                content={content}
                version={activeVersion?.version}
                status={activeVersion?.status}
                artifactKey={currentArtifact.key}
                updatedAt={updatedAt}
                onCloseAction={closePanel}
                isStreaming={!!isStreaming}
                isUpdating={!!isUpdating}
            />
        </div>
    );
}
