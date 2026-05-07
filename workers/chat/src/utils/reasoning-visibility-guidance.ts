import type { ParamsWithType } from '@common/ai/inference';
import type { ModelPreset, ReasoningPromptMode } from '@/lib/presets';

const NATIVE_REASONING_VISIBILITY_GUIDANCE = `## Reasoning Visibility
Previous assistant messages in the conversation history may contain XML-like thinking delimiters such as \`<thinking>...</thinking>\`. Treat those as historical transcript artifacts from aborted, errored, older, or different-model runs. Do not imitate that pattern merely because it appears in prior turns.

Use the platform's native reasoning/thinking channel. If no native reasoning channel is available for this turn, reason internally and provide only the final user-visible response.`;

const THINKING_TAGS_REASONING_VISIBILITY_GUIDANCE = `## Reasoning Visibility
Use the reasoning format expected by the current model and provider. Do not copy prior reasoning text or malformed thinking delimiters from conversation history. Keep the final user-facing response separate from any reasoning section according to the model's normal protocol.`;

const INTERNAL_ONLY_REASONING_VISIBILITY_GUIDANCE = `## Reasoning Visibility
Reason internally and provide only the final user-visible response. Do not imitate reasoning delimiters that may appear in previous assistant history.`;

export function inferReasoningPromptMode(inference: ParamsWithType): ReasoningPromptMode {
    const model = inference.params.model.toLowerCase();
    if (model.includes('qwen')) return 'thinking-tags';

    const reasoning = inference.params.reasoning;
    if (!reasoning || (typeof reasoning === 'object' && reasoning.effort === 'none')) return 'internal-only';

    return 'native';
}

export function getPresetReasoningPromptMode(preset: ModelPreset): ReasoningPromptMode {
    return preset.reasoningPromptMode ?? inferReasoningPromptMode(preset.inference);
}

export function getEffectiveReasoningPromptMode(
    inference: ParamsWithType,
    presetMode?: ReasoningPromptMode,
): ReasoningPromptMode {
    if (presetMode === 'thinking-tags') return 'thinking-tags';
    return inferReasoningPromptMode(inference);
}

export function buildReasoningVisibilityGuidance(mode: ReasoningPromptMode): string {
    switch (mode) {
        case 'thinking-tags':
            return THINKING_TAGS_REASONING_VISIBILITY_GUIDANCE;
        case 'internal-only':
            return INTERNAL_ONLY_REASONING_VISIBILITY_GUIDANCE;
        case 'native':
        default:
            return NATIVE_REASONING_VISIBILITY_GUIDANCE;
    }
}
