'use client';

import { useAuth } from '@clerk/nextjs';
import { cva } from 'class-variance-authority';
import { FileText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { cn } from '@/lib/utils';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import type { MessageArtifactRef } from '@/modules/chat/types';
import { VersionStatusBadge } from './version-status-badge';

const indicatorVariants = cva(
    'group w-full max-w-[400px] flex items-center gap-4 rounded-3 border p-4 my-4 text-left transition-colors disabled:cursor-default disabled:opacity-50 bg-gradient-to-br',
    {
        variants: {
            state: {
                default:
                    'from-neutral-400/5 via-neutral-400/3 to-neutral-400/2 border-border hover:from-neutral-400/10 hover:via-neutral-400/6 hover:to-neutral-400/3',
                selected: 'from-neutral-400/12 via-neutral-400/10 to-neutral-400/6 border-neutral-500/50',
            },
        },
        defaultVariants: {
            state: 'default',
        },
    },
);

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
    const { panelState, openPanel, closePanel } = useActivePanelContext();
    const { artifacts, addArtifact, updateArtifact } = useArtifactContext();

    const artifactId = artifactRef?.id ?? documentName ?? null;
    const title = artifactRef?.title ?? documentName ?? 'Document';
    const artifactInContext = artifactId ? artifacts[artifactId] : null;
    const status = (artifactInContext?.proposed_version ?? artifactInContext?.current_version)?.status;
    const version =
        documentVersion ??
        (artifactInContext
            ? (artifactInContext.proposed_version?.version ?? artifactInContext.current_version?.version)
            : undefined);

    const isSelected = panelState?.panel === 'artifact-preview' && panelState.artifactId === artifactId;

    const handleClick = async () => {
        if (artifactRef || artifactInContext) {
            if (isSelected) {
                closePanel();
            } else {
                openPanel({ panel: 'artifact-preview', artifactId: artifactId ?? null });
            }
            return;
        }

        if (!projectId || !documentName) return;

        addArtifact({
            id: documentName,
            key: documentName,
            title: documentName,
            isLoading: true,
        });
        openPanel({ panel: 'artifact-preview', artifactId: documentName });

        try {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, documentName);

            if (artifact) {
                updateArtifact(documentName, {
                    key: artifact.key,
                    title: artifact.title,
                    current_version: artifact.current_version ?? undefined,
                    proposed_version: artifact.proposed_version ?? undefined,
                    updated_at: artifact.updated_at,
                    isLoading: false,
                });
            } else {
                updateArtifact(documentName, { isLoading: false });
            }
        } catch (error) {
            console.error('Failed to fetch artifact:', error);
            updateArtifact(documentName, { isLoading: false });
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={artifactInContext?.isLoading}
            className={cn(indicatorVariants({ state: isSelected ? 'selected' : 'default' }), className)}
        >
            <FileText className="size-6 shrink-0 text-neutral-500" />

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{title}</span>
                    {status && <VersionStatusBadge status={status} />}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
                    {version && <span>v{version}</span>}
                    {documentAction && (
                        <>
                            {version && <span>·</span>}
                            <span className="capitalize">{documentAction}</span>
                        </>
                    )}
                </div>
            </div>
        </button>
    );
}
