/**
 * Chat-metadata recovery flag for provider-confirmed context overflows.
 *
 * - `maybeRecordContextOverflow` (write side): stamps `chat.metadata.contextOverflow`
 *   when a provider classifies a turn as `context_length`.
 * - `resolveContextOverflowGate` (read side): merges the local estimator with
 *   that stamped flag using a stricter-wins rule, so the next preflight can
 *   short-circuit even when the estimator undercounts.
 */

import type { ErrorClassification } from '@/common/ai';
import { CHAT_CONTEXT_HARD_LIMIT_TOKENS, CHAT_CONTEXT_WARNING_TOKENS } from './context-budget';
import type { ContextGateDetails } from './context-gate-error';

export type ContextOverflowState = 'soft' | 'hard';
export type ContextOverflowLevel = 'none' | ContextOverflowState;

/**
 * If `classification` is a context-length failure, stamp `metadata.contextOverflow`
 * on the chat. No-op for any other classification (notably `INCOMPLETE_RESPONSE` /
 * output truncation, which is a different concept).
 */
export function maybeRecordContextOverflow(
    chat: { metadata?: Record<string, unknown> | null },
    classification: ErrorClassification,
    estimatedTokens?: number,
): void {
    if (classification.code !== 'CONTEXT_TOO_LONG') return;
    const overflow: ContextOverflowState =
        estimatedTokens !== undefined && estimatedTokens >= CHAT_CONTEXT_HARD_LIMIT_TOKENS ? 'hard' : 'soft';
    chat.metadata = { ...(chat.metadata ?? {}), contextOverflow: overflow };
}

const LEVEL_RANK: Record<ContextOverflowLevel, number> = { none: 0, soft: 1, hard: 2 };

/**
 * Decide which gate (if any) the preflight should fire, given the estimator
 * result and any provider-confirmed overflow stamped on chat metadata.
 *
 * Stricter wins: an estimator `'hard'` always beats a metadata `'soft'`, and
 * vice versa. Ties resolve to estimator so `source: 'estimator'` is reported
 * whenever the estimator already reached the same level on its own.
 */
export function resolveContextOverflowGate({
    estimatedTokens,
    metadataOverflow,
}: {
    estimatedTokens: number;
    metadataOverflow: ContextOverflowState | undefined;
}): { level: ContextOverflowLevel; source: 'estimator' | 'provider_error' } {
    const estimatorLevel: ContextOverflowLevel =
        estimatedTokens >= CHAT_CONTEXT_HARD_LIMIT_TOKENS
            ? 'hard'
            : estimatedTokens >= CHAT_CONTEXT_WARNING_TOKENS
              ? 'soft'
              : 'none';
    const metadataLevel: ContextOverflowLevel = metadataOverflow ?? 'none';

    if (LEVEL_RANK[estimatorLevel] >= LEVEL_RANK[metadataLevel]) {
        return { level: estimatorLevel, source: 'estimator' };
    }
    return { level: metadataLevel, source: 'provider_error' };
}

/**
 * Decide whether the preflight should fire a context gate, accounting for
 * resolved overflow level + the caller's escape-hatch flags. Returns the full
 * gate-error details ready to feed into `buildContextGateError`, or `null` if
 * the request may proceed (no gate reached, or flags waive it).
 */
export function evaluateContextGate({
    estimatedTokens,
    metadataOverflow,
    forceBrief,
    bypassContextWarning,
}: {
    estimatedTokens: number;
    metadataOverflow: ContextOverflowState | undefined;
    forceBrief?: boolean;
    bypassContextWarning?: boolean;
}): ContextGateDetails | null {
    const { level, source } = resolveContextOverflowGate({ estimatedTokens, metadataOverflow });

    if (level === 'hard' && !forceBrief) {
        return {
            gate: 'hard',
            source,
            estimatedTokens,
            limitTokens: CHAT_CONTEXT_HARD_LIMIT_TOKENS,
            canBypass: false,
            canForceBrief: true,
        };
    }
    if (level === 'soft' && !forceBrief && !bypassContextWarning) {
        return {
            gate: 'warning',
            source,
            estimatedTokens,
            limitTokens: CHAT_CONTEXT_WARNING_TOKENS,
            canBypass: true,
            canForceBrief: true,
        };
    }
    return null;
}
