'use client';

import { useAuth } from '@clerk/nextjs';
import { AlertTriangle, ArrowRight, FileCheck, TrendingUp, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useMemo, useState } from 'react';
import { createProjectArtifactApi } from '@/lib/api/client/fetchers/project-artifacts';
import { getCompletionBriefKey } from '@/lib/artifacts/utils';
import { cn } from '@/lib/utils';
import { useArtifactActions } from '@/modules/artifacts/providers/artifact-provider';
import { usePhaseGate } from '@/modules/chat/hooks/use-phase-gate';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { getContextLevel, getContextPercent } from '@/modules/chat/utils';

// =============================================================================
// Types
// =============================================================================

type PillStage = 'caution' | 'warn' | 'review' | 'ready';

type StageConfig = {
    label: string;
    icon: React.ReactNode;
};

// =============================================================================
// Stage Configuration
// =============================================================================

const STAGE_CONFIGS: Record<PillStage, StageConfig> = {
    caution: {
        label: 'Context usage growing \u2014 Generate Completion Brief',
        icon: <TrendingUp className="size-4 shrink-0" />,
    },
    warn: {
        label: 'Context running low \u2014 Generate Completion Brief',
        icon: <AlertTriangle className="size-4 shrink-0" />,
    },
    review: {
        label: 'Review Completion Brief',
        icon: <FileCheck className="size-4 shrink-0" />,
    },
    ready: {
        label: 'Switch to next phase',
        icon: <ArrowRight className="size-4 shrink-0" />,
    },
};

// =============================================================================
// Background Helpers
// =============================================================================

const SHIMMER_SWEEP =
    'linear-gradient(90deg, transparent 0%, transparent 35%, rgba(255,255,255,0.12) 50%, transparent 65%, transparent 100%)';

const REVIEW_GRADIENT = 'linear-gradient(90deg, rgba(34,197,94,0.9), rgba(249,115,22,0.75), rgba(34,197,94,0.9))';

const STAGE_BASE_COLORS = {
    caution: 'rgb(161,98,7)',
    warn: 'rgb(185,28,28)',
    review: 'rgb(21,128,61)',
    ready: 'rgb(21,128,61)',
} as const;

// =============================================================================
// Component
// =============================================================================

export function ContextWarningPill() {
    const { getToken } = useAuth();
    const {
        summarizeChat,
        chatType,
        projectId,
        state: { tokenUsage, completionBriefStatus, isGenerating, isSummarizing, isLoading, phaseIndex },
    } = useChatContext();

    const { openPanel } = useActivePanelContext();
    const { addArtifact, updateArtifact, getArtifact } = useArtifactActions();
    const { canTransition, requestCbGeneration } = usePhaseGate();

    const contextPercent = getContextPercent(tokenUsage);

    const contextLevel = getContextLevel(contextPercent);

    const stage = useMemo((): PillStage | null => {
        if (completionBriefStatus === 'approved' && contextLevel !== 'normal') return 'ready';
        if (completionBriefStatus === 'proposed' && contextLevel !== 'normal') return 'review';
        if (contextLevel === 'critical') return 'warn';
        if (contextLevel === 'caution') return 'caution';
        return null;
    }, [contextLevel, completionBriefStatus]);

    const [cautionDismissed, setCautionDismissed] = useState(false);

    const isBusy = isGenerating || isSummarizing || isLoading;
    const shouldRender =
        stage !== null &&
        chatType === 'phase' &&
        canTransition &&
        !isBusy &&
        !(stage === 'caution' && cautionDismissed);

    // -- Stage 2: Open CB in artifact preview panel ----------------------------

    const handleReviewCb = useCallback(async () => {
        const cbKey = getCompletionBriefKey((phaseIndex ?? 0) + 1);
        const cbVersion = 1;

        const cached = getArtifact(cbKey, cbVersion);
        if (cached) {
            openPanel({ panel: 'artifact-preview', artifactId: cbKey, version: cbVersion });
            return;
        }

        addArtifact({ id: cbKey, key: cbKey, title: 'Completion Brief', isLoading: true }, cbVersion);
        openPanel({ panel: 'artifact-preview', artifactId: cbKey, version: cbVersion });

        try {
            const fetched = projectId
                ? await createProjectArtifactApi(getToken).getByKey(projectId, cbKey, cbVersion)
                : null;

            if (fetched) {
                updateArtifact(
                    cbKey,
                    {
                        key: fetched.key,
                        title: fetched.title,
                        currentVersion: fetched.currentVersion ?? undefined,
                        proposedVersion: fetched.proposedVersion ?? undefined,
                        pecp: fetched.pecp ?? undefined,
                        updatedAt: fetched.updatedAt,
                        isLoading: false,
                    },
                    cbVersion,
                );
            } else {
                updateArtifact(cbKey, { isLoading: false }, cbVersion);
            }
        } catch {
            updateArtifact(cbKey, { isLoading: false }, cbVersion);
        }
    }, [phaseIndex, getArtifact, addArtifact, updateArtifact, openPanel, projectId, getToken]);

    // -- Render ----------------------------------------------------------------

    const handleClick = useCallback(() => {
        if (stage === 'caution' || stage === 'warn') requestCbGeneration();
        else if (stage === 'review') handleReviewCb();
        else if (stage === 'ready') summarizeChat();
    }, [stage, requestCbGeneration, handleReviewCb, summarizeChat]);

    const handleDismiss = useCallback((event: React.SyntheticEvent) => {
        event.stopPropagation();
        setCautionDismissed(true);
    }, []);

    const pillBaseColor = stage ? STAGE_BASE_COLORS[stage] : undefined;
    const pillBackground = stage === 'review' ? REVIEW_GRADIENT : SHIMMER_SWEEP;

    if (!shouldRender || !stage) return null;

    const config = STAGE_CONFIGS[stage];

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="flex justify-center mb-3"
            >
                <button
                    type="button"
                    onClick={handleClick}
                    className={cn(
                        'relative overflow-hidden rounded-full px-5 py-2.5 text-sm font-medium text-white/90 shadow-lg cursor-pointer',
                        'border border-white/10',
                        'transition-shadow hover:shadow-xl',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                    style={{
                        backgroundColor: pillBaseColor,
                        backgroundImage: pillBackground,
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 4s infinite linear',
                    }}
                >
                    <AnimatePresence mode="wait">
                        <motion.span
                            key={stage}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-center gap-2"
                        >
                            {config.icon}
                            {config.label}
                            {stage === 'caution' && (
                                <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={handleDismiss}
                                    onKeyDown={(event) => event.key === 'Enter' && handleDismiss(event)}
                                    className="ml-1 rounded-full p-0.5 hover:bg-white/15 transition-colors"
                                >
                                    <X className="size-3.5" />
                                </span>
                            )}
                        </motion.span>
                    </AnimatePresence>
                </button>
            </motion.div>
        </AnimatePresence>
    );
}
