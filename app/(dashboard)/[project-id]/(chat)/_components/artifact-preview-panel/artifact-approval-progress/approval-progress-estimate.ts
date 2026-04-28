import { DOCUMENT_CHAR_ESTIMATES, type DocumentType } from '@/lib/schema/artifact';
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

const INTERNAL_SAVING_START_RANGE: ProgressRange = [74, 80];

// UX pacing hints: document-specific sizing comes from DOCUMENT_CHAR_ESTIMATES,
// while these constants model fixed approval overhead plus per-1k-char preparation cost.
const INTERNAL_GENERATION_BASE_MS = 18_000;
const INTERNAL_GENERATION_MS_PER_1K_CHARS = 4200;
const INTERNAL_GENERATION_MIN_MS = 45_000;
const INTERNAL_GENERATION_MAX_MS = 180_000;

type StageProgressInput = {
    stage: ProcessingStage;
    isInternal?: boolean;
    operationKey: string;
};

type ApprovalWorkInput = {
    contentLength: number;
    documentType?: DocumentType;
};

type ApprovalProgressInput = ApprovalWorkInput & {
    stage: ProcessingStage;
    stageElapsedMs: number;
    backendProgress?: number;
    isInternal?: boolean;
    operationKey: string;
};

type StageFallbackInput = {
    elapsedMs: number;
    isInternal?: boolean;
};

type StageDurationInput = ApprovalWorkInput & {
    stage: ProcessingStage;
    isInternal?: boolean;
};

type ExpectationInput = {
    elapsedMs: number;
    isConfirmed: boolean;
    stage: ProcessingStage;
    isInternal?: boolean;
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function easeOutQuad(ratio: number): number {
    return 1 - (1 - ratio) ** 2;
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
    if (contentLength > 0) return clamp(contentLength, 1000, 60_000);

    const typeEstimate = documentType ? DOCUMENT_CHAR_ESTIMATES[documentType] : DEFAULT_CONTENT_LENGTH;
    return clamp(typeEstimate, 1000, 60_000);
}

function getStageStart({ stage, isInternal, operationKey }: StageProgressInput): number {
    const range = stage === 'saving' && isInternal ? INTERNAL_SAVING_START_RANGE : STAGE_START_RANGES[stage];
    return getStableRangeValue(range, `${operationKey}:${stage}:start`);
}

function getStageCap({ stage, operationKey }: StageProgressInput): number {
    return getStableRangeValue(STAGE_CAP_RANGES[stage], `${operationKey}:${stage}:cap`);
}

function getInternalGenerationDurationMs({ contentLength, documentType }: ApprovalWorkInput): number {
    const workSize = getApprovalWorkSize({ contentLength, documentType });
    const sizeBasedDuration = INTERNAL_GENERATION_BASE_MS + (workSize / 1000) * INTERNAL_GENERATION_MS_PER_1K_CHARS;
    return clamp(sizeBasedDuration, INTERNAL_GENERATION_MIN_MS, INTERNAL_GENERATION_MAX_MS);
}

function getStageDurationMs({ stage, contentLength, documentType, isInternal }: StageDurationInput): number {
    if (stage === 'generating-ai-content') {
        if (isInternal) {
            return getInternalGenerationDurationMs({ contentLength, documentType });
        }

        const workSize = getApprovalWorkSize({ contentLength, documentType });
        return clamp(6000 + workSize * 0.25, 8000, 24_000);
    }

    if (stage === 'queued') return 1200;
    if (stage === 'classifying') return 4500;
    if (stage === 'finalizing') return 8000;
    return 3500;
}

export function getApprovalProgress({
    stage,
    stageElapsedMs,
    backendProgress,
    isInternal,
    contentLength,
    documentType,
    operationKey,
}: ApprovalProgressInput): number {
    const stageStart = getStageStart({ stage, isInternal, operationKey });
    const floor = Math.max(stageStart, backendProgress ?? 0);
    const cap = Math.max(floor, getStageCap({ stage, isInternal, operationKey }));
    const ratio = clamp(stageElapsedMs / getStageDurationMs({ stage, contentLength, documentType, isInternal }), 0, 1);
    const estimatedProgress = floor + easeOutQuad(ratio) * (cap - floor);

    return clamp(Math.round(estimatedProgress), 4, MAX_UNCONFIRMED_PROGRESS);
}

export function getFallbackApprovalStage({ elapsedMs, isInternal }: StageFallbackInput): ProcessingStage {
    if (elapsedMs < 1200) return 'queued';
    if (elapsedMs < 6000) return 'classifying';

    if (isInternal) {
        if (elapsedMs < 30_000) return 'generating-ai-content';
        if (elapsedMs < 34_000) return 'saving';
        if (elapsedMs < 39_000) return 'indexing';
        return 'finalizing';
    }

    if (elapsedMs < 9000) return 'saving';
    if (elapsedMs < 13_000) return 'indexing';
    return 'finalizing';
}

export function getApprovalExpectationLabel({ elapsedMs, isConfirmed, stage, isInternal }: ExpectationInput): string {
    if (isConfirmed) return 'Confirmed';
    if (elapsedMs < 8000) return 'Usually a few seconds';

    if (stage === 'generating-ai-content' && isInternal) {
        if (elapsedMs < 90_000) return 'Preparing workspace context';
        if (elapsedMs < 150_000) return 'May take a little longer';
        return 'Taking longer than usual';
    }

    if (stage === 'generating-ai-content' && elapsedMs < 45_000) return 'May take a little longer';
    if (elapsedMs < 30_000) return 'Still working';
    return 'Taking longer than usual';
}
