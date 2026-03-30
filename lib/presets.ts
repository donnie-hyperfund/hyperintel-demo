import { AIParamsType, type ParamsWithType } from '@common/ai/inference/types';
import { ANTHROPIC_MODELS, COMMON_MODELS } from '@common/ai/types';
import { LOCAL_PRESETS } from './presets.local';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelPreset = {
    id: string;
    label: string;
    description?: string;
    inference: ParamsWithType;
};

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

const BASE_PRESETS: ModelPreset[] = [
    {
        id: 'haiku',
        label: 'Haiku 4.5',
        description: 'Fast & cheap',
        inference: {
            paramsType: AIParamsType.Anthropic,
            params: { model: ANTHROPIC_MODELS.HAIKU, thinking: false },
        },
    },
    {
        id: 'sonnet',
        label: 'Sonnet 4.6',
        description: 'Balanced',
        inference: {
            paramsType: AIParamsType.Anthropic,
            params: { model: ANTHROPIC_MODELS.SONNET, thinking: true, thinkingBudget: 8000 },
        },
    },
    {
        id: 'opus',
        label: 'Opus 4.5',
        description: 'Max quality',
        inference: {
            paramsType: AIParamsType.Anthropic,
            params: { model: ANTHROPIC_MODELS.OPUS, thinking: true, thinkingBudget: 16000 },
        },
    },
    //
    {
        id: 'gpt-5.4',
        label: 'GPT 5.4',
        description: 'OpenAI latest',
        inference: {
            paramsType: AIParamsType.OpenRouter,
            params: { model: COMMON_MODELS.GPT_5_4, reasoning: true },
        },
    },
    {
        id: 'gemini-3-flash',
        label: 'Gemini 3 Flash',
        description: 'Google latest fast',
        inference: {
            paramsType: AIParamsType.OpenRouter,
            params: { model: COMMON_MODELS.GEMINI_FLASH_3, reasoning: true },
        },
    },
    {
        id: 'qwen',
        label: 'Qwen 3.5',
        description: 'Fast & cheap',
        inference: {
            paramsType: AIParamsType.OpenRouter,
            params: { model: COMMON_MODELS.QWEN_3_5, reasoning: true },
        },
    },
    {
        id: 'qwen-local',
        label: 'Qwen 3.5 27b',
        description: 'Brainiac 🧠',
        inference: {
            paramsType: AIParamsType.OpenAI,
            params: {
                model: 'mradermacher/brayniac-qwen3.5-27b-heretic-i1',
                baseUrl: 'http://localhost:1234/v1',
                // reasoning: true,
                // Use KV quant Q4 and high context
                // Q4_K_S is good
            },
        },
    },
    {
        id: 'qwen-local-9b',
        label: 'Qwen 3.5 9b',
        description: 'Qwen local',
        inference: {
            paramsType: AIParamsType.OpenAI,
            params: {
                model: 'qwen/qwen3.5-9b',
                baseUrl: 'http://localhost:1234/v1',
                // reasoning: true,
                // Q4_K_M is good
            },
        },
    },
];

// Merge local overrides — same id replaces, new id appends
function mergePresets(base: ModelPreset[], local: ModelPreset[]): ModelPreset[] {
    const merged = base.map((p) => local.find((l) => l.id === p.id) ?? p);
    const added = local.filter((l) => !base.some((p) => p.id === l.id));
    return [...merged, ...added];
}

const MODEL_PRESETS: ModelPreset[] = LOCAL_PRESETS.length ? mergePresets(BASE_PRESETS, LOCAL_PRESETS) : BASE_PRESETS;

export const DEFAULT_PRESET_ID = 'sonnet';

// ---------------------------------------------------------------------------
// Env-based filtering
// ---------------------------------------------------------------------------

/**
 * Filter presets by env vars. Both lists are comma-separated preset IDs.
 * If ALLOWED is non-empty, only those are kept. Then BLOCKED removes from remainder.
 * If both are empty, all presets are available.
 */
export function getAvailablePresets(allowed?: string, blocked?: string): ModelPreset[] {
    let presets = MODEL_PRESETS;

    if (allowed?.trim()) {
        const ids = new Set(allowed.split(',').map((s) => s.trim()));
        presets = presets.filter((p) => ids.has(p.id));
    }

    if (blocked?.trim()) {
        const ids = new Set(blocked.split(',').map((s) => s.trim()));
        presets = presets.filter((p) => !ids.has(p.id));
    }

    return presets;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a preset ID to its ParamsWithType. Returns null if not found or not allowed.
 */
export function resolvePreset(presetId: string, allowed?: string, blocked?: string): ParamsWithType | null {
    const available = getAvailablePresets(allowed, blocked);
    return available.find((p) => p.id === presetId)?.inference ?? null;
}
