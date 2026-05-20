'use client';

import type { StreamBlock } from '@/common/ai/agent/types';
import { ThinkingShimmer } from './thinking-shimmer';
import { useThinkingLabel } from './use-thinking-label';

type ProductionThinkingBlockProps = {
    blocks: StreamBlock[];
    isStreaming?: boolean;
    status?: string;
};

export function ProductionThinkingBlock({ blocks, isStreaming, status }: ProductionThinkingBlockProps) {
    const { doneLabel, isThinking } = useThinkingLabel(blocks, isStreaming, {
        includeActions: false,
    });

    if (isThinking) {
        return <ThinkingShimmer label={status || 'Thinking'} />;
    }

    return (
        <div className="mb-2 py-2 text-sm text-muted-foreground/70">
            <span className="font-medium">{doneLabel}</span>
        </div>
    );
}
