'use client';

import { motion } from 'motion/react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { MAX_CONTEXT_TOKENS } from '@/modules/chat/constants';
import type { TokenUsage } from '@/modules/chat/types';
import { getContextLevel, getContextPercent } from '@/modules/chat/utils';

type ContextUsageIndicatorProps = {
    tokenUsage: TokenUsage | null;
    className?: string;
};

function formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return String(tokens);
}

export function ContextUsageIndicator({ tokenUsage, className }: ContextUsageIndicatorProps) {
    const { percentage, color } = useMemo(() => {
        if (!tokenUsage) return { percentage: 0, color: 'bg-green-500' };

        const pct = getContextPercent(tokenUsage);
        const level = getContextLevel(pct);
        const c = level === 'critical' ? 'bg-red-500' : level === 'caution' ? 'bg-yellow-500' : 'bg-green-500';

        return { percentage: pct, color: c };
    }, [tokenUsage]);

    if (!tokenUsage) return null;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}
        >
            <div className="flex items-center gap-1.5 min-w-0">
                <div className="w-16 h-1 rounded-full bg-neutral-800 overflow-hidden">
                    <motion.div
                        className={cn('h-full rounded-full', color)}
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                </div>
                <span className="whitespace-nowrap tabular-nums text-neutral-600">
                    {formatTokenCount(tokenUsage.usedTokens)} / {formatTokenCount(MAX_CONTEXT_TOKENS)}
                </span>
            </div>
        </motion.div>
    );
}
