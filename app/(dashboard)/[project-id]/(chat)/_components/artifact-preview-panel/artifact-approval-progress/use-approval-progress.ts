import { useEffect, useMemo, useRef } from 'react';
import type { DocumentType } from '@/lib/schema/artifact';
import type { ProcessingEntry, ProcessingStage } from '@/modules/artifacts/processing/types';
import {
    getApprovalExpectationLabel,
    getApprovalProgress,
    getFallbackApprovalStage,
} from './approval-progress-estimate';
import { useTicker } from './use-ticker';

type UseApprovalProgressOptions = {
    entry?: ProcessingEntry;
    documentType?: DocumentType;
    isInternal?: boolean;
    contentLength: number;
};

type ApprovalProgressState = {
    stage: ProcessingStage;
    detailLabel: string;
    progress: number;
    progressLabel: string;
};

export function useApprovalProgress({
    entry,
    documentType,
    isInternal,
    contentLength,
}: UseApprovalProgressOptions): ApprovalProgressState {
    const fallbackStartedAtRef = useRef(Date.now());
    const stageStartedAtRef = useRef(Date.now());
    const previousStageRef = useRef<ProcessingStage | null>(null);
    const now = useTicker();

    const startedAt = entry?.startedAt ?? fallbackStartedAtRef.current;
    const elapsedMs = Math.max(0, now - startedAt);
    const isConfirmed = entry?.status === 'completed';
    const operationKey = entry?.versionId ?? `${documentType ?? 'document'}:${contentLength}:${startedAt}`;

    const stage = useMemo<ProcessingStage>(() => {
        if (isConfirmed) return 'finalizing';
        return entry?.stage ?? getFallbackApprovalStage({ elapsedMs, isInternal });
    }, [elapsedMs, entry?.stage, isConfirmed, isInternal]);

    useEffect(() => {
        if (previousStageRef.current === stage) return;
        previousStageRef.current = stage;
        stageStartedAtRef.current = Date.now();
    }, [stage]);

    const stageElapsedMs = Math.max(0, now - stageStartedAtRef.current);
    const progress = isConfirmed
        ? 100
        : getApprovalProgress({
              stage,
              stageElapsedMs,
              backendProgress: entry?.progress,
              isInternal,
              contentLength,
              documentType,
              operationKey,
          });

    return {
        stage,
        progress,
        detailLabel: getApprovalExpectationLabel({ elapsedMs, isConfirmed, stage }),
        progressLabel: isConfirmed ? `${progress}% confirmed` : `${progress}% estimated`,
    };
}
