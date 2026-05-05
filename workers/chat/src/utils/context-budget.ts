import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import type { ContextMessage } from '@common/ai/inference/types';
import { estimateContextTokens, estimateTextTokens, estimateToolTokens } from '@common/ai/utils';
import { ErrorStatus, PublicError } from '@common/common/error.helpers';
import { CONTEXT_GATE_HARD_TOKENS, CONTEXT_GATE_WARNING_TOKENS } from '@/lib/constants/context-limits';

export const CHAT_CONTEXT_LIMIT_TOKENS = CONTEXT_GATE_WARNING_TOKENS;
export const CHAT_CONTEXT_WARNING_TOKENS = CONTEXT_GATE_WARNING_TOKENS;
export const CHAT_CONTEXT_HARD_LIMIT_TOKENS = CONTEXT_GATE_HARD_TOKENS;
export const SUMMARIZER_SONNET_4_6_CONTEXT_THRESHOLD_TOKENS = CONTEXT_GATE_WARNING_TOKENS;

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
