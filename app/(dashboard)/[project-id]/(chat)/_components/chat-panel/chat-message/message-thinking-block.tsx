'use client';

import type { StreamBlock } from '@/common/ai/agent/types';
import { IS_DEV } from '@/lib/config';
import { DevelopmentThinkingBlock } from './development-thinking-block';
import { ProductionThinkingBlock } from './production-thinking-block';

type MessageThinkingBlockProps = {
    blocks: StreamBlock[];
    defaultExpanded: boolean;
    isStreaming?: boolean;
    hasTextContent?: boolean;
    status?: string;
};

export function MessageThinkingBlock(props: MessageThinkingBlockProps) {
    if (IS_DEV) return <DevelopmentThinkingBlock {...props} />;
    return <ProductionThinkingBlock {...props} />;
}
