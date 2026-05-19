'use client';

import { useAuth } from '@clerk/nextjs';
import { cva } from 'class-variance-authority';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { createProjectArtifactApi } from '@/lib/api/client/fetchers/project-artifacts';
import { cn } from '@/lib/utils';
import { DEFAULT_DOCUMENT_TYPE_ICON } from '@/modules/artifacts/constants';
import { useArtifactActions } from '@/modules/artifacts/providers/artifact-provider';
import { getDocumentTypeIcon, isDocumentType } from '@/modules/artifacts/utils';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useScrollTargetContext } from '@/modules/chat/providers/scroll-target-provider';

const indicatorVariants = cva(
    'group w-full max-w-[400px] flex items-center gap-4 rounded-3 border p-4 my-4 text-left transition-colors disabled:cursor-default disabled:opacity-50 bg-gradient-to-br cursor-pointer',
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
    documentType: string;
    isReference?: boolean;
    className?: string;
};

export function ArtifactIndicator({
    documentName,
    documentVersion,
    documentType,
    isReference,
    className,
}: ArtifactIndicatorProps) {
    const { getToken } = useAuth();

    const { panelState, pushPanel, closePanel } = useActivePanelContext();
    const { addArtifact } = useArtifactActions();
    const { projectId } = useChatContext();
    const { target: scrollTarget, markFound, clear: clearScrollTarget } = useScrollTargetContext();
    const Icon = isDocumentType(documentType) ? getDocumentTypeIcon(documentType) : DEFAULT_DOCUMENT_TYPE_ICON;

    const buttonRef = useRef<HTMLButtonElement>(null);
    const [isLoading, setIsLoading] = useState(false);

    const isScrollTarget =
        !isReference && scrollTarget?.key === documentName && scrollTarget.version === documentVersion;

    const isSelected =
        panelState?.panel === 'artifact-preview' &&
        panelState.artifactKey === documentName &&
        panelState.version === documentVersion;

    const openArtifactPreview = useCallback(async () => {
        setIsLoading(true);

        try {
            const fetchedArtifact = projectId
                ? await createProjectArtifactApi(getToken).getByKey(projectId, documentName, documentVersion)
                : await createArtifactApi(getToken).getByKey(documentName, documentVersion);

            if (fetchedArtifact) {
                addArtifact(
                    {
                        ...fetchedArtifact,
                        id: fetchedArtifact.id,
                        key: fetchedArtifact.key,
                        isLoading: false,
                    },
                    documentVersion,
                );
                pushPanel(
                    {
                        panel: 'artifact-preview',
                        artifactId: fetchedArtifact.id,
                        artifactKey: fetchedArtifact.key,
                        version: documentVersion,
                    },
                    { reset: true },
                );
            }
        } catch (error) {
            console.error('Failed to fetch artifact:', error);
        } finally {
            setIsLoading(false);
        }
    }, [documentName, documentVersion, getToken, addArtifact, pushPanel, projectId]);

    const handleClick = () => {
        if (isSelected) {
            closePanel();
            return;
        }
        void openArtifactPreview();
    };

    useEffect(() => {
        if (!isScrollTarget || !buttonRef.current) return;

        markFound();

        const button = buttonRef.current;
        let cancelled = false;
        let raf1: number | undefined;
        let raf2: number | undefined;

        void openArtifactPreview();

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
            if (e.animationName === 'highlight-pulse') {
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
                isScrollTarget && 'highlight-pulse',
                className,
            )}
        >
            <Icon className="size-6 shrink-0 text-neutral-500" />

            <div className="min-w-0 flex-1">
                <span className="text-sm font-medium line-clamp-1">{documentName}</span>
                <div className="mt-0.5 text-xs text-neutral-500">v{documentVersion}</div>
            </div>
        </button>
    );
}
