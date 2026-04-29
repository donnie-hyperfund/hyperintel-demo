import { DOCUMENT_CHAR_ESTIMATES, type DocumentType, INTERNAL_DOCUMENTS } from '@/lib/schema/artifact';
import type { ProcessingStage } from '@/modules/artifacts/processing/types';

const MAX_UNCONFIRMED_PROGRESS = 97;
const DEFAULT_CONTENT_LENGTH = DOCUMENT_CHAR_ESTIMATES.Other;

type ProgressRange = readonly [number, number];

const STAGE_CAP_RANGES: Record<ProcessingStage, ProgressRange> = {
    queued: [7, 10],
    classifying: [20, 24],
    'generating-ai-content': [82, 86],
    saving: [86, 89],
    publishing: [87, 90],
    indexing: [91, 94],
    finalizing: [96, MAX_UNCONFIRMED_PROGRESS],
};

const STAGE_START_RANGES: Record<ProcessingStage, ProgressRange> = {
    queued: [3, 5],
    classifying: [9, 13],
    'generating-ai-content': [23, 29],
    saving: [58, 66],
    publishing: [82, 86],
    indexing: [87, 91],
    finalizing: [93, 95],
};

const STAGE_DURATIONS_MS = {
    queued: 1200,
    classifying: 4500,
    saving: 3500,
    publishing: 3500,
    indexing: 3500,
    finalizing: 8000,
} satisfies Record<Exclude<ProcessingStage, 'generating-ai-content'>, number>;

const AI_CONTENT_PREPARATION_REFERENCE = {
    documentType: 'Genesis DNA',
    totalApprovalMs: 90_000,
    minMs: 45_000,
    maxMs: 180_000,
} satisfies {
    documentType: DocumentType;
    totalApprovalMs: number;
    minMs: number;
    maxMs: number;
};

const AI_CONTENT_DOCUMENT_TYPES = new Set<DocumentType>(INTERNAL_DOCUMENTS);

type StageProgressInput = {
    stage: ProcessingStage;
    backendProgress?: number;
    operationKey: string;
};

type ApprovalWorkInput = {
    contentLength: number;
    documentType?: DocumentType;
    isInternal?: boolean;
};

type ApprovalProgressInput = ApprovalWorkInput & {
    stage: ProcessingStage;
    stageElapsedMs: number;
    backendProgress?: number;
    operationKey: string;
};

type StageFallbackInput = {
    elapsedMs: number;
};

type StageDurationInput = ApprovalWorkInput & {
    stage: ProcessingStage;
};

type ExpectationInput = ApprovalWorkInput & {
    elapsedMs: number;
    isConfirmed: boolean;
    stage: ProcessingStage;
    hasObservedAiContentStage?: boolean;
};

type ApprovalTimingLabels = {
    expectationLabel: string;
    paceLabel?: string;
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function easeOutQuad(ratio: number): number {
    return 1 - (1 - ratio) ** 2;
}

function easeInOutSine(ratio: number): number {
    return -(Math.cos(Math.PI * ratio) - 1) / 2;
}

function getHashRatio(input: string): number {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0xffffffff;
}

function getStableRangeValue(range: ProgressRange, seed: string): number {
    const [min, max] = range;
    return Math.round(min + getHashRatio(seed) * (max - min));
}

function getApprovalWorkSize({ contentLength, documentType }: ApprovalWorkInput): number {
    const measuredLength = contentLength > 0 ? contentLength : 0;
    const typeEstimate = documentType ? DOCUMENT_CHAR_ESTIMATES[documentType] : DEFAULT_CONTENT_LENGTH;
    return clamp(Math.max(measuredLength, typeEstimate), 1000, 60_000);
}

function getStageStart({ stage, backendProgress, operationKey }: StageProgressInput): number {
    const stageStart = getStableRangeValue(STAGE_START_RANGES[stage], `${operationKey}:${stage}:start`);
    return Math.max(stageStart, backendProgress ?? 0);
}

function getStageCap({ stage, operationKey }: StageProgressInput): number {
    return getStableRangeValue(STAGE_CAP_RANGES[stage], `${operationKey}:${stage}:cap`);
}

function getBaseApprovalDurationMs(): number {
    return (
        STAGE_DURATIONS_MS.queued +
        STAGE_DURATIONS_MS.classifying +
        STAGE_DURATIONS_MS.saving +
        STAGE_DURATIONS_MS.indexing +
        STAGE_DURATIONS_MS.finalizing
    );
}

function getAiContentPreparationDurationMs({ contentLength, documentType }: ApprovalWorkInput): number {
    const workSize = getApprovalWorkSize({ contentLength, documentType });
    const referenceWorkSize = DOCUMENT_CHAR_ESTIMATES[AI_CONTENT_PREPARATION_REFERENCE.documentType];
    const referenceDuration = AI_CONTENT_PREPARATION_REFERENCE.totalApprovalMs - getBaseApprovalDurationMs();
    const sizeBasedDuration = referenceDuration * (workSize / referenceWorkSize);

    return clamp(sizeBasedDuration, AI_CONTENT_PREPARATION_REFERENCE.minMs, AI_CONTENT_PREPARATION_REFERENCE.maxMs);
}

function getStageDurationMs({ stage, contentLength, documentType }: StageDurationInput): number {
    if (stage === 'generating-ai-content') {
        return getAiContentPreparationDurationMs({ contentLength, documentType });
    }

    return STAGE_DURATIONS_MS[stage];
}

function getStageProgressRatio({
    stage,
    durationMs,
    stageElapsedMs,
}: {
    stage: ProcessingStage;
    durationMs: number;
    stageElapsedMs: number;
}): number {
    const ratio = clamp(stageElapsedMs / durationMs, 0, 1);
    if (stage === 'generating-ai-content') return easeInOutSine(ratio);
    return easeOutQuad(ratio);
}

function shouldIncludeAiContentPreparation({
    stage,
    hasObservedAiContentStage,
    documentType,
    isInternal,
}: {
    stage: ProcessingStage;
    hasObservedAiContentStage?: boolean;
    documentType?: DocumentType;
    isInternal?: boolean;
}): boolean {
    return (
        stage === 'generating-ai-content' ||
        !!hasObservedAiContentStage ||
        isInternal === true ||
        (!!documentType && AI_CONTENT_DOCUMENT_TYPES.has(documentType))
    );
}

function getExpectedApprovalDurationMs({
    stage,
    hasObservedAiContentStage,
    contentLength,
    documentType,
    isInternal,
}: ApprovalWorkInput & { stage: ProcessingStage; hasObservedAiContentStage?: boolean }): number {
    const baseDuration = getBaseApprovalDurationMs();

    if (!shouldIncludeAiContentPreparation({ stage, hasObservedAiContentStage, documentType, isInternal })) {
        return baseDuration;
    }

    return baseDuration + getAiContentPreparationDurationMs({ contentLength, documentType });
}

export function getApprovalProgress({
    stage,
    stageElapsedMs,
    backendProgress,
    contentLength,
    documentType,
    operationKey,
}: ApprovalProgressInput): number {
    const floor = getStageStart({ stage, backendProgress, operationKey });
    const cap = Math.max(floor, getStageCap({ stage, operationKey }));
    const durationMs = getStageDurationMs({ stage, contentLength, documentType });
    const ratio = getStageProgressRatio({ stage, durationMs, stageElapsedMs });
    const estimatedProgress = floor + ratio * (cap - floor);

    return clamp(Math.round(estimatedProgress), 4, MAX_UNCONFIRMED_PROGRESS);
}

export function getFallbackApprovalStage({ elapsedMs }: StageFallbackInput): ProcessingStage {
    if (elapsedMs < STAGE_DURATIONS_MS.queued) return 'queued';
    if (elapsedMs < STAGE_DURATIONS_MS.queued + STAGE_DURATIONS_MS.classifying) return 'classifying';

    if (elapsedMs < 9000) return 'saving';
    if (elapsedMs < 13_000) return 'indexing';
    return 'finalizing';
}

function getInitialExpectationLabel(expectedDurationMs: number): string {
    if (expectedDurationMs < 30_000) return 'Usually quick';
    if (expectedDurationMs < 75_000) return 'Can take about a minute';
    return 'Can take a minute or two';
}

export function getApprovalTimingLabels({
    elapsedMs,
    isConfirmed,
    stage,
    hasObservedAiContentStage,
    contentLength,
    documentType,
    isInternal,
}: ExpectationInput): ApprovalTimingLabels {
    if (isConfirmed) return { expectationLabel: 'Confirmed' };

    const expectedDurationMs = getExpectedApprovalDurationMs({
        stage,
        hasObservedAiContentStage,
        contentLength,
        documentType,
        isInternal,
    });
    const expectationLabel = getInitialExpectationLabel(expectedDurationMs);

    if (elapsedMs < 8000) return { expectationLabel };

    const elapsedRatio = elapsedMs / expectedDurationMs;
    if (elapsedRatio < 0.75) return { expectationLabel, paceLabel: 'On track' };
    if (elapsedRatio < 1.25) return { expectationLabel, paceLabel: 'Still within estimate' };
    return { expectationLabel, paceLabel: 'Taking longer than expected' };
}
