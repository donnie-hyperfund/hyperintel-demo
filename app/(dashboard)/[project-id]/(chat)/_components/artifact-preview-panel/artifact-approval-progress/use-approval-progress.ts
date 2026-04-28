import { useMemo, useRef } from 'react';
import type { DocumentType } from '@/lib/schema/artifact';
import type { ProcessingEntry, ProcessingStage } from '@/modules/artifacts/processing/types';
import { getApprovalProgress, getApprovalTimingLabels, getFallbackApprovalStage } from './approval-progress-estimate';
import { useTicker } from './use-ticker';

type UseApprovalProgressOptions = {
    entry?: ProcessingEntry;
    documentType?: DocumentType;
    contentLength: number;
};

type ApprovalProgressState = {
    stage: ProcessingStage;
    expectationLabel: string;
    paceLabel?: string;
    progress: number;
    progressLabel: string;
};

export function useApprovalProgress({
    entry,
    documentType,
    contentLength,
}: UseApprovalProgressOptions): ApprovalProgressState {
    const fallbackStartedAtRef = useRef(Date.now());
    const stageStartedAtRef = useRef(Date.now());
    const previousStageRef = useRef<ProcessingStage | null>(null);
    const previousOperationKeyRef = useRef<string | null>(null);
    const maxProgressRef = useRef(0);
    const hasObservedAiContentStageRef = useRef(false);
    const now = useTicker();

    const startedAt = entry?.startedAt ?? fallbackStartedAtRef.current;
    const elapsedMs = Math.max(0, now - startedAt);
    const isConfirmed = entry?.status === 'completed';
    const operationKey = entry?.versionId ?? `${documentType ?? 'document'}:${contentLength}:${startedAt}`;

    if (previousOperationKeyRef.current !== operationKey) {
        previousOperationKeyRef.current = operationKey;
        previousStageRef.current = null;
        stageStartedAtRef.current = now;
        maxProgressRef.current = 0;
        hasObservedAiContentStageRef.current = false;
    }

    const stage = useMemo<ProcessingStage>(() => {
        if (isConfirmed) return 'finalizing';
        return (
            entry?.stage ??
            getFallbackApprovalStage({
                elapsedMs,
                hasObservedAiContentStage: hasObservedAiContentStageRef.current,
                contentLength,
                documentType,
            })
        );
    }, [elapsedMs, entry?.stage, isConfirmed, contentLength, documentType]);

    if (previousStageRef.current !== stage) {
        previousStageRef.current = stage;
        stageStartedAtRef.current = now;
    }

    if (entry?.stage === 'generating-ai-content') {
        hasObservedAiContentStageRef.current = true;
    }

    const stageElapsedMs = Math.max(0, now - stageStartedAtRef.current);
    const estimatedProgress = isConfirmed
        ? 100
        : getApprovalProgress({
              stage,
              stageElapsedMs,
              backendProgress: entry?.progress,
              contentLength,
              documentType,
              operationKey,
          });
    const progress = Math.max(maxProgressRef.current, estimatedProgress);
    maxProgressRef.current = progress;
    const timingLabels = getApprovalTimingLabels({
        elapsedMs,
        isConfirmed,
        stage,
        hasObservedAiContentStage: hasObservedAiContentStageRef.current,
        contentLength,
        documentType,
    });

    return {
        stage,
        progress,
        expectationLabel: timingLabels.expectationLabel,
        paceLabel: timingLabels.paceLabel,
        progressLabel: isConfirmed ? `${progress}% confirmed` : `${progress}% estimated`,
    };
}
