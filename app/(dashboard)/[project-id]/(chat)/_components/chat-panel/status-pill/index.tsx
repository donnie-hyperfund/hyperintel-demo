'use client';

import { AnimatePresence } from 'motion/react';
import { CompletionBriefReviewPill } from './completion-brief-review-pill';
import { ContextWarningPill } from './context-warning-pill';
import { NextPhasePill } from './next-phase-pill';
import { useChatStatusPillStage } from './use-chat-status-pill-stage';

type ChatStatusPillProps = {
    className?: string;
};

export function ChatStatusPill({ className }: ChatStatusPillProps) {
    const stage = useChatStatusPillStage();

    return (
        <AnimatePresence mode="wait">
            {stage === 'ready' && <NextPhasePill key="ready" className={className} />}
            {stage === 'review' && <CompletionBriefReviewPill key="review" className={className} />}
            {(stage === 'caution' || stage === 'warn') && (
                <ContextWarningPill key="context-warning" stage={stage} className={className} />
            )}
        </AnimatePresence>
    );
}
