'use client';

import { useAuth } from '@clerk/nextjs';
import { cva } from 'class-variance-authority';
import { FileText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { cn } from '@/lib/utils';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';

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
    documentName: string;
    documentVersion: number;
    className?: string;
};

export function ArtifactIndicator({
    documentName,
    documentVersion,
    className,
}: ArtifactIndicatorProps) {
    const params = useParams();
    const projectId = params['project-id'] as string;
    const { getToken } = useAuth();

    const { panelState, openPanel, closePanel } = useActivePanelContext();
    const { getArtifact, addArtifact, updateArtifact } = useArtifactContext();

    const artifact = getArtifact(documentName, documentVersion);
    const isLoading = artifact?.isLoading ?? false;

    const isSelected =
        panelState?.panel === 'artifact-preview' &&
        panelState.artifactId === documentName &&
        panelState.version === documentVersion;

    const handleClick = async () => {
        if (isSelected) {
            closePanel();
            return;
        }

        if (artifact) {
            openPanel({ panel: 'artifact-preview', artifactId: documentName, version: documentVersion });
            return;
        }

        if (!projectId) return;

        addArtifact(
            {
                id: documentName,
                key: documentName,
                title: documentName,
                isLoading: true,
            },
            documentVersion,
        );
        openPanel({ panel: 'artifact-preview', artifactId: documentName, version: documentVersion });

        try {
            const api = createArtifactApi(getToken);
            const fetchedArtifact = await api.getByKey(projectId, documentName, documentVersion);

            if (fetchedArtifact) {
                updateArtifact(
                    documentName,
                    {
                        key: fetchedArtifact.key,
                        title: fetchedArtifact.title,
                        current_version: fetchedArtifact.current_version ?? undefined,
                        proposed_version: fetchedArtifact.proposed_version ?? undefined,
                        updated_at: fetchedArtifact.updated_at,
                        isLoading: false,
                    },
                    documentVersion,
                );
            } else {
                updateArtifact(documentName, { isLoading: false }, documentVersion);
            }
        } catch (error) {
            console.error('Failed to fetch artifact:', error);
            updateArtifact(documentName, { isLoading: false }, documentVersion);
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isLoading}
            className={cn(indicatorVariants({ state: isSelected ? 'selected' : 'default' }), className)}
        >
            <FileText className="size-6 shrink-0 text-neutral-500" />

            <div className="min-w-0 flex-1">
                <span className="text-sm font-medium truncate">{documentName}</span>
                <div className="mt-0.5 text-xs text-neutral-500">v{documentVersion}</div>
            </div>
        </button>
    );
}
