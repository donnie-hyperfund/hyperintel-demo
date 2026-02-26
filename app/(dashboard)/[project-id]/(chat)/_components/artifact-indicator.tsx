'use client';

import { useAuth } from '@clerk/nextjs';
import { cva } from 'class-variance-authority';
import { FileText } from 'lucide-react';

import { useCallback, useEffect, useRef } from 'react';
import { createProjectArtifactApi } from '@/lib/api/client/fetchers/project-artifacts';
import { cn } from '@/lib/utils';
import { useArtifactContext } from '@/modules/artifacts/providers/artifact-provider';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useScrollTargetContext } from '@/modules/chat/providers/scroll-target-provider';

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

export function ArtifactIndicator({ documentName, documentVersion, className }: ArtifactIndicatorProps) {
    const { projectId } = useChatContext();
    const { getToken } = useAuth();

    const { panelState, openPanel, closePanel } = useActivePanelContext();
    const { getArtifact, addArtifact, updateArtifact } = useArtifactContext();
    const { target: scrollTarget, markFound, clear: clearScrollTarget } = useScrollTargetContext();

    const buttonRef = useRef<HTMLButtonElement>(null);

    const artifact = getArtifact(documentName, documentVersion);
    const isLoading = artifact?.isLoading ?? false;

    const isScrollTarget = scrollTarget?.key === documentName && scrollTarget.version === documentVersion;

    const isSelected =
        panelState?.panel === 'artifact-preview' &&
        panelState.artifactId === documentName &&
        panelState.version === documentVersion;

    const openArtifactPreview = useCallback(async () => {
        if (artifact) {
            openPanel({ panel: 'artifact-preview', artifactId: documentName, version: documentVersion });
            return;
        }

        if (!projectId) return;

        addArtifact({ id: documentName, key: documentName, title: documentName, isLoading: true }, documentVersion);
        openPanel({ panel: 'artifact-preview', artifactId: documentName, version: documentVersion });

        try {
            const api = createProjectArtifactApi(getToken);
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
    }, [documentName, documentVersion, artifact, projectId, getToken, addArtifact, updateArtifact, openPanel]);

    const handleClick = () => {
        if (isSelected) {
            closePanel();
            return;
        }
        openArtifactPreview();
    };

    useEffect(() => {
        if (!isScrollTarget || !buttonRef.current) return;

        markFound();

        const button = buttonRef.current;
        let cancelled = false;
        let raf1: number | undefined;
        let raf2: number | undefined;

        openArtifactPreview();

        // Double-rAF waits for React commit + browser paint,
        //    so the ResizablePanelGroup layout has settled before we scroll
        raf1 = requestAnimationFrame(() => {
            if (cancelled) return;
            raf2 = requestAnimationFrame(() => {
                if (cancelled) return;
                button.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });

        // Clear scroll target when the CSS highlight animation actually finishes
        const handleAnimationEnd = (e: AnimationEvent) => {
            if (e.animationName === 'artifact-scroll-highlight') {
                clearScrollTarget();
            }
        };
        button.addEventListener('animationend', handleAnimationEnd);

        return () => {
            cancelled = true;
            if (raf1 !== undefined) cancelAnimationFrame(raf1);
            if (raf2 !== undefined) cancelAnimationFrame(raf2);
            button.removeEventListener('animationend', handleAnimationEnd);
        };
    }, [isScrollTarget, markFound, clearScrollTarget, openArtifactPreview]);

    return (
        <button
            ref={buttonRef}
            type="button"
            onClick={handleClick}
            disabled={isLoading}
            title={documentName}
            className={cn(
                indicatorVariants({ state: isSelected ? 'selected' : 'default' }),
                isScrollTarget && 'artifact-scroll-highlight',
                className,
            )}
        >
            <FileText className="size-6 shrink-0 text-neutral-500" />

            <div className="min-w-0 flex-1">
                <span className="text-sm font-medium line-clamp-1">{documentName}</span>
                <div className="mt-0.5 text-xs text-neutral-500">v{documentVersion}</div>
            </div>
        </button>
    );
}
