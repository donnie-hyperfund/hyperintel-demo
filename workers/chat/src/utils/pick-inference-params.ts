import { AIParamsType, type ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { looksLikeCompletionBriefIntent } from './cb-intent';
import { CHAT_CONTEXT_WARNING_TOKENS } from './context-budget';

export interface PickInferenceParamsInput {
    defaultInference: ParamsWithType;
    estimatedTokens: number;
    bypassContextWarning?: boolean;
    forceBrief?: boolean;
    message: string | null | undefined;
    overrideInference?: ParamsWithType;
}

export interface PickInferenceParamsResult {
    inferenceParams: ParamsWithType;
    effectivePresetOverride: 'sonnet-4.6' | undefined;
}

/**
 * Pick the inference params for a chat turn. Falls back to Sonnet 4.6 when
 * the turn is high-context, the user bypassed/forced through a gate, or the
 * message looks like an explicit CB request. `overrideInference` (test path)
 * always wins.
 */
export function pickInferenceParams({
    defaultInference,
    estimatedTokens,
    bypassContextWarning,
    forceBrief,
    message,
    overrideInference,
}: PickInferenceParamsInput): PickInferenceParamsResult {
    const shouldUseSonnet46 =
        estimatedTokens >= CHAT_CONTEXT_WARNING_TOKENS ||
        bypassContextWarning ||
        forceBrief ||
        looksLikeCompletionBriefIntent(message);

    const sonnet46Inference: ParamsWithType = {
        paramsType: AIParamsType.Anthropic,
        params: {
            model: ANTHROPIC_MODELS.SONNET_4_6,
            searchEnabled: true,
            reasoning: { effort: 'medium' },
            betas: { context1m: true },
        },
    };

    const inferenceParams = overrideInference ?? (shouldUseSonnet46 ? sonnet46Inference : defaultInference);
    const effectivePresetOverride = !overrideInference && shouldUseSonnet46 ? ('sonnet-4.6' as const) : undefined;

    return { inferenceParams, effectivePresetOverride };
}
