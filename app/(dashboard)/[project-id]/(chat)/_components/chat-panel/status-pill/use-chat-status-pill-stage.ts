import { useMemo } from 'react';
import { usePhaseGate } from '@/modules/chat/hooks/use-phase-gate';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import type { TokenUsage } from '@/modules/chat/types';
import { getContextLevel, getContextPercent } from '@/modules/chat/utils';
import type { ContextWarningStage } from './context-warning-pill';
import { useIsCompletionBriefReviewSuppressed } from './use-is-completion-brief-review-suppressed';

export type ChatStatusPillStage = 'ready' | 'review' | ContextWarningStage;

function resolveContextStage(
    contextOverflow: 'soft' | 'hard' | null,
    tokenUsage: TokenUsage | null,
): ChatStatusPillStage | null {
    if (contextOverflow === 'hard') return 'warn';
    if (contextOverflow === 'soft') return 'caution';

    const contextLevel = getContextLevel(getContextPercent(tokenUsage));
    if (contextLevel === 'critical') return 'warn';
    if (contextLevel === 'caution') return 'caution';
    return null;
}

export function useChatStatusPillStage(): ChatStatusPillStage | null {
    const {
        chatType,
        state: {
            tokenUsage,
            completionBriefStatus,
            isGenerating,
            isSummarizing,
            isLoading,
            contextOverflow,
            phaseIndex,
        },
    } = useChatContext();
    const { canTransition } = usePhaseGate();
    const isCompletionBriefReviewSuppressed = useIsCompletionBriefReviewSuppressed(phaseIndex);

    return useMemo(() => {
        const isPhaseChatReady = chatType === 'phase' && canTransition;
        const isBusy = isGenerating || isSummarizing || isLoading;
        if (!isPhaseChatReady || isBusy) return null;

        if (completionBriefStatus === 'approved') return 'ready';
        if (completionBriefStatus === 'proposed') return isCompletionBriefReviewSuppressed ? null : 'review';

        return resolveContextStage(contextOverflow, tokenUsage);
    }, [
        chatType,
        canTransition,
        completionBriefStatus,
        isCompletionBriefReviewSuppressed,
        tokenUsage,
        contextOverflow,
        isGenerating,
        isSummarizing,
        isLoading,
    ]);
}
