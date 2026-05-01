import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import type { ContextMessage } from '@common/ai/inference/types';
import { estimateContextTokens, estimateTextTokens, estimateToolTokens } from '@common/ai/utils';
import { ErrorStatus, PublicError } from '@common/common/error.helpers';

export const CHAT_CONTEXT_LIMIT_TOKENS = 180_000;
export const CHAT_CONTEXT_WARNING_TOKENS = 180_000;
export const CHAT_CONTEXT_HARD_LIMIT_TOKENS = 300_000;
export const SUMMARIZER_SONNET_4_6_CONTEXT_THRESHOLD_TOKENS = 180_000;

export function estimateInferenceInputTokens({
    instructions,
    context,
    tools,
    toolGroups,
    preprocessContext,
}: {
    instructions: string;
    context: ContextMessage[];
    tools: Parameters<typeof estimateToolTokens>[0];
    toolGroups?: AgentToolGroup[];
    preprocessContext?: (messages: ContextMessage[]) => ContextMessage[];
}): number {
    const processedContext = preprocessContext ? preprocessContext(context) : context;
    const toolTokens = estimateToolTokens(tools, toolGroups);

    return estimateTextTokens(instructions) + estimateContextTokens(processedContext) + toolTokens.total;
}

export function createContextLimitError(
    estimatedTokens: number,
    limitTokens = CHAT_CONTEXT_LIMIT_TOKENS,
    message = 'This phase has reached the context limit. Create a Completion Brief and move to the next phase before continuing.',
): PublicError {
    return new PublicError(ErrorStatus.BadRequest, {
        code: 'CONTEXT_TOO_LONG',
        message,
        details: {
            estimatedTokens,
            limitTokens,
        },
    });
}
