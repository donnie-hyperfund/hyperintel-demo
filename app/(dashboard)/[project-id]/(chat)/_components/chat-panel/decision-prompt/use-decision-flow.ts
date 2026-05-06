'use client';

import { useEffect, useState } from 'react';
import { DECISION_OTHER_SENTINEL, type PendingDecision } from '@/lib/schema/stream';
import type { DecisionSubmission } from '@/modules/chat/hooks/use-stream';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export type DecisionFlow = {
    active: PendingDecision | null;
    submission: DecisionSubmission | undefined;
    isSubmitting: boolean;
    otherText: string;
    setOtherText: (text: string) => void;
    selectOption: (value: string) => void;
    selectOptionByIndex: (index: number) => void;
    submitOther: () => void;
    dismiss: () => void;
};

export function useDecisionFlow(): DecisionFlow {
    const { pendingDecisions, submittingDecisions, selectDecision, dismissDecision } = useChatContext();
    const active = pendingDecisions[0] ?? null;
    const activeId = active?.toolCallId ?? null;
    const submission = activeId ? submittingDecisions[activeId] : undefined;
    const isSubmitting = !!submission;

    const [otherText, setOtherText] = useState('');

    useEffect(() => {
        setOtherText('');
    }, [activeId]);

    const selectOption = (value: string) => {
        if (!active || isSubmitting) return;
        selectDecision(active.toolCallId, value);
    };

    const selectOptionByIndex = (index: number) => {
        const option = active?.options[index];
        if (option) selectOption(option.value);
    };

    const submitOther = () => {
        if (!active || isSubmitting) return;
        const text = otherText.trim();
        if (!text) return;
        selectDecision(active.toolCallId, DECISION_OTHER_SENTINEL, text);
    };

    const dismiss = () => {
        if (!active || isSubmitting) return;
        dismissDecision(active.toolCallId);
    };

    return {
        active,
        submission,
        isSubmitting,
        otherText,
        setOtherText,
        selectOption,
        selectOptionByIndex,
        submitOther,
        dismiss,
    };
}
