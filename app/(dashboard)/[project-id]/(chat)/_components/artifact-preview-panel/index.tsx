'use client';

import { useAuth } from '@clerk/nextjs';
import { FileText, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { createProjectArtifactApi } from '@/lib/api/client/fetchers/project-artifacts';
import { useArtifact, useArtifactActions } from '@/modules/artifacts/providers/artifact-provider';
import {
    getLatestArtifactVersion,
    getLatestArtifactVersionContent,
    getLatestArtifactVersionTitle,
} from '@/modules/artifacts/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { ArtifactViewer } from './artifact-viewer';

type ArtifactPreviewPanelProps = {
    version: number;
    artifactId: string;
    artifactKey: string;
    onClose: () => void;
};

export const ArtifactPreviewPanel = ({ version, artifactId, artifactKey, onClose }: ArtifactPreviewPanelProps) => {
    const { getToken } = useAuth();
    const { addArtifact } = useArtifactActions();
    const chatContext = useChatContext();
    const projectId = chatContext.chatType === 'phase' ? chatContext.projectId : undefined;
    const currentArtifact = useArtifact(artifactId, version);

    useEffect(() => {
        if (currentArtifact || !artifactKey || !version) return;

        let cancelled = false;
        const loadArtifact = async () => {
            try {
                const fetchedArtifact = projectId
                    ? await createProjectArtifactApi(getToken).getByKey(projectId, artifactKey, version)
                    : await createArtifactApi(getToken).getByKey(artifactKey, version);
                if (cancelled || !fetchedArtifact) return;
                addArtifact(
                    {
                        ...fetchedArtifact,
                        id: fetchedArtifact.id,
                        key: fetchedArtifact.key || artifactKey,
                        isLoading: false,
                    },
                    version,
                );
            } catch (error) {
                console.error('Failed to load artifact preview', error);
            }
        };

        void loadArtifact();
        return () => {
            cancelled = true;
        };
    }, [currentArtifact, artifactKey, version, projectId, getToken, addArtifact]);

    const { isLoading, isStreaming } = currentArtifact ?? {};

    const content = currentArtifact ? getLatestArtifactVersionContent(currentArtifact) : '';
    const activeVersion = currentArtifact ? getLatestArtifactVersion(currentArtifact) : undefined;
    const isInternal = activeVersion?.isInternal;

    const summaryContent =
        currentArtifact?.summaryStreaming ??
        currentArtifact?.proposedVersion?.summaryInternal ??
        currentArtifact?.currentVersion?.summaryInternal ??
        '';
    const showSkeleton = (isLoading || (isStreaming && (!isInternal || !summaryContent))) && !content;

    if (showSkeleton) {
        return (
            <div className="flex flex-col h-full bg-neutral-975 animate-in fade-in duration-300">
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <div className="text-center space-y-4">
                        <Loader2 className="size-12 mx-auto animate-spin text-primary" />
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">
                                {(currentArtifact && getLatestArtifactVersionTitle(currentArtifact)) ||
                                    'Loading document...'}
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
                        <p className="text-sm">
                            {artifactKey ? 'Loading document...' : 'Select a document to preview'}
                        </p>
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
