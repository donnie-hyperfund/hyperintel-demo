/**
 * Internal Summary Service — gates which document types receive an auto-generated
 * PE-facing drawer brief.
 *
 * The summary is written into the parent version's `summary_internal` field by
 * the internal summary generator (see pecp-generator.ts; file name retained for
 * operational compatibility with the existing Langfuse slug).
 */

import type { DocumentType } from '@/lib/schema/artifact';

const MATERIAL_REVISION_THRESHOLD = 0.15;

export const INTERNAL_SUMMARY_DOCUMENT_TYPES: readonly DocumentType[] = [
    'Genesis DNA',
    'Legacy DNA',
    'Team Specification',
    'MID',
    'PSEB',
    'Action Plan',
    'Completion Brief',
] as const;

/** Returns true when the given document type should get an auto-generated Internal Summary on finalize. */
export function shouldGenerateInternalSummary(documentType: string): boolean {
    return (INTERNAL_SUMMARY_DOCUMENT_TYPES as readonly string[]).includes(documentType);
}

function estimateChangedRatio(previousContent: string, nextContent: string): number {
    if (previousContent === nextContent) return 0;

    const baselineLength = Math.max(previousContent.length, nextContent.length);
    if (baselineLength === 0) return 0;

    let prefixLength = 0;
    const maxPrefix = Math.min(previousContent.length, nextContent.length);
    while (prefixLength < maxPrefix && previousContent[prefixLength] === nextContent[prefixLength]) {
        prefixLength++;
    }

    let suffixLength = 0;
    const maxSuffix = maxPrefix - prefixLength;
    while (
        suffixLength < maxSuffix &&
        previousContent[previousContent.length - 1 - suffixLength] ===
            nextContent[nextContent.length - 1 - suffixLength]
    ) {
        suffixLength++;
    }

    const previousChanged = previousContent.length - prefixLength - suffixLength;
    const nextChanged = nextContent.length - prefixLength - suffixLength;
    return Math.max(previousChanged, nextChanged) / baselineLength;
}

export function shouldReuseInternalSummaryForRevision({
    previousContent,
    nextContent,
    previousSummary,
    threshold = MATERIAL_REVISION_THRESHOLD,
}: {
    previousContent?: string | null;
    nextContent: string;
    previousSummary?: string | null;
    threshold?: number;
}): boolean {
    // Product-approved cost-control heuristic for minor proposed-version churn.
    // This is not semantic diffing; larger edits regenerate the drawer brief.
    if (!previousSummary?.trim() || !previousContent) return false;
    return estimateChangedRatio(previousContent, nextContent) < threshold;
}
