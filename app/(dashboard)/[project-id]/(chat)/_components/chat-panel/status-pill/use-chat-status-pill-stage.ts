import { useMemo } from 'react';
import { usePhaseGate } from '@/modules/chat/hooks/use-phase-gate';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { getContextLevel, getContextPercent } from '@/modules/chat/utils';
import type { ContextWarningStage } from './context-warning-pill';

export type ChatStatusPillStage = 'ready' | 'review' | ContextWarningStage;

export function useChatStatusPillStage(): ChatStatusPillStage | null {
    const {
        chatType,
        state: { tokenUsage, completionBriefStatus, isGenerating, isSummarizing, isLoading, contextOverflow },
    } = useChatContext();
    const { canTransition } = usePhaseGate();

    return useMemo(() => {
        if (chatType !== 'phase' || !canTransition) return null;
        if (isGenerating || isSummarizing || isLoading) return null;

        if (completionBriefStatus === 'approved') return 'ready';
        if (completionBriefStatus === 'proposed') return 'review';

        if (contextOverflow === 'hard') return 'warn';
        if (contextOverflow === 'soft') return 'caution';

        const contextLevel = getContextLevel(getContextPercent(tokenUsage));
        if (contextLevel === 'critical') return 'warn';
        if (contextLevel === 'caution') return 'caution';
        return null;
    }, [chatType, canTransition, completionBriefStatus, tokenUsage, contextOverflow, isGenerating, isSummarizing, isLoading]);
}
