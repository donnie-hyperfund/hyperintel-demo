'use client';

import { useAuth } from '@clerk/nextjs';
import { FileText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { cn } from '@/lib/utils';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import type { MessageArtifactRef } from '@/modules/chat/types';

type ArtifactIndicatorProps = {
    /** Artifact reference when artifact is already in context */
    artifactRef?: MessageArtifactRef;
    /** Document name for fetching from backend */
    documentName?: string;
    /** Document version */
    documentVersion?: number;
    /** Action indicator (created, replaced, updated) */
    documentAction?: string;
    className?: string;
};

export function ArtifactIndicator({
    artifactRef,
    documentName,
    documentVersion,
    documentAction,
    className,
}: ArtifactIndicatorProps) {
    const params = useParams();
    const projectId = params['project-id'] as string;
    const { getToken } = useAuth();
    const { currentArtifactId, setCurrentArtifact, artifacts, addArtifact, setLoading, isLoading } =
        useArtifactContext();

    // Determine the artifact ID and title
    const artifactId = artifactRef?.id ?? (documentVersion ? `doc-${documentName}-v${documentVersion}` : null);
    const title = artifactRef?.title ?? documentName ?? 'Document';
    const artifactInContext = artifactId ? artifacts[artifactId] : null;

    const isSelected = currentArtifactId === artifactId;

    // Get action icon
    // const getActionLabel = () => {
    //     if (!documentAction) return null;
    //     switch (documentAction) {
    //         case 'created':
    //             return 'Created';
    //         case 'replaced':
    //             return 'Replaced';
    //         default:
    //             return 'Updated';
    //     }
    // };

    const handleClick = async () => {
        // If we have an artifact ref or it's already in context, just show it
        if (artifactRef || artifactInContext) {
            setCurrentArtifact(isSelected ? null : (artifactId ?? null));
            return;
        }

        // Need to fetch from backend
        if (!projectId || !documentName) return;

        // Open panel with loading state immediately
        setLoading(true, documentName);

        try {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, documentName);

            if (artifact) {
                // Create a local artifact ID and add to context
                const localArtifactId = `doc-${documentName}-v${artifact.version}`;
                addArtifact({
                    id: localArtifactId,
                    identifier: artifact.key,
                    title: artifact.title,
                    type: 'text/markdown',
                    content: artifact.current_version?.content ?? '',
                    messageId: '',
                });
                setCurrentArtifact(localArtifactId);
            } else {
                setLoading(false);
            }
        } catch (error) {
            console.error('Failed to fetch artifact:', error);
            setLoading(false);
        }
    };

    // const actionLabel = getActionLabel();

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isLoading}
            className={cn(
                'cursor-pointer group relative w-full min-w-[280px] max-w-[400px] flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-200 text-left hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-50',
                isSelected
                    ? 'bg-gradient-to-br from-green-500/14 via-green-500/10 to-neutral-500/12 border-green-400/35 shadow-sm shadow-green-400/8'
                    : 'bg-gradient-to-br from-green-500/6 via-green-500/4 to-neutral-500/5 border-neutral-200/5 hover:border-green-400/20',
                className,
            )}
        >
            {/* Gradient overlay on hover */}
            <div className="absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 bg-gradient-to-br from-green-500/4 to-neutral-500/5 group-hover:opacity-100" />

            {/* Icon container with gradient background */}
            <div className="relative shrink-0 size-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-green-600 to-emerald-500 shadow-sm shadow-green-400/15">
                <FileText className="size-5 text-white/95" strokeWidth={2} />
            </div>

            {/* Content */}
            <div className="relative flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold truncate text-foreground group-hover:text-green-500 transition-colors duration-200">
                        {title}
                    </span>
                    {documentVersion && (
                        <span className="text-xs text-muted-foreground font-medium">v{documentVersion}</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-medium">{'Deliverable'}</span>
                    {isSelected && <span className="text-xs text-green-500 font-medium">• Open</span>}
                </div>
            </div>

            {/* Selection indicator */}
            {isSelected && <div className="absolute top-2 right-2 size-2 rounded-full bg-green-500" />}
        </button>
    );
}
