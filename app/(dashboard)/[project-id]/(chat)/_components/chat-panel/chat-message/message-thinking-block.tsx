'use client';

import type { StreamBlock } from '@/common/ai/agent/types';
import { DevelopmentThinkingBlock } from './development-thinking-block';
import { ProductionThinkingBlock } from './production-thinking-block';

const IS_DEV = process.env.NEXT_PUBLIC_APP_ENV === 'development';

type MessageThinkingBlockProps = {
    blocks: StreamBlock[];
    defaultExpanded: boolean;
    isStreaming?: boolean;
    status?: string;
};

export function MessageThinkingBlock(props: MessageThinkingBlockProps) {
    if (IS_DEV) return <DevelopmentThinkingBlock {...props} />;
    return <ProductionThinkingBlock {...props} />;
}
