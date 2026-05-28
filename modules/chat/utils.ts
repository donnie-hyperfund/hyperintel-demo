import { CONTEXT_THRESHOLDS, MAX_CONTEXT_TOKENS_UI } from './constants';
import type { TokenUsage } from './types';

export type ContextLevel = 'normal' | 'caution' | 'critical';

export function getContextLevel(percentage: number): ContextLevel {
    if (percentage >= CONTEXT_THRESHOLDS.critical) return 'critical';
    if (percentage >= CONTEXT_THRESHOLDS.caution) return 'caution';
    return 'normal';
}

export function getContextPercent(tokenUsage: TokenUsage | null): number {
    if (!tokenUsage) return 0;
    return Math.min((tokenUsage.usedTokens / MAX_CONTEXT_TOKENS_UI) * 100, 100);
}
