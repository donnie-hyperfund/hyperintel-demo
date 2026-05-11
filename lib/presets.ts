import type { ModelPricing } from '@common/ai/inference/pricing';
import { AIParamsType, type ParamsWithType } from '@common/ai/inference/types';
import { ANTHROPIC_MODELS, COMMON_MODELS, OPENAI_MODELS } from '@common/ai/types';
import { LOCAL_PRESETS } from './presets.local';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelPreset = {
    id: string;
    label: string;
    description?: string;
    inference: ParamsWithType;
    reasoningPromptMode?: ReasoningPromptMode;
    pricing?: ModelPricing;
};

export type ReasoningPromptMode = 'native' | 'thinking-tags' | 'internal-only';

// Anthropic prompt-cache rate factors (applied as multipliers of inputPer1M):
//   read        = 0.10× base input
//   write 5m    = 1.25× base input
//   write 1h    = 2.00× base input  (schema-only — see pricing.ts TODO)
const ANTHROPIC_CACHE: Pick<ModelPricing, 'cacheRead' | 'cacheWrite' | 'cacheWrite1h'> = {
    cacheRead: { multiplier: 0.1 },
    cacheWrite: { multiplier: 1.25 },
    cacheWrite1h: { multiplier: 2.0 },
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
            params: { model: ANTHROPIC_MODELS.HAIKU, reasoning: false },
        },
        reasoningPromptMode: 'internal-only',
        pricing: {
            inputPer1M: 1,
            outputPer1M: 5,
            ...ANTHROPIC_CACHE,
        },
    },
    {
        id: 'sonnet45',
        label: 'Sonnet 4.5',
        description: 'Balanced',
        inference: {
            paramsType: AIParamsType.Anthropic,
            params: { model: ANTHROPIC_MODELS.SONNET, reasoning: true, reasoningBudget: 8000 },
        },
        reasoningPromptMode: 'native',
        pricing: {
            inputPer1M: 3,
            outputPer1M: 15,
            ...ANTHROPIC_CACHE,
        },
    },
    {
        id: 'sonnet',
        label: 'Sonnet 4.6',
        description: 'Balanced',
        inference: {
            paramsType: AIParamsType.Anthropic,
            params: {
                model: ANTHROPIC_MODELS.SONNET_4_6,
                reasoning: { effort: 'medium' },
                betas: { context1m: true },
            },
        },
        reasoningPromptMode: 'native',
        pricing: {
            inputPer1M: 3,
            outputPer1M: 15,
            ...ANTHROPIC_CACHE,
        },
    },
    {
        id: 'opus',
        label: 'Opus 4.6',
        description: 'Max quality',
        inference: {
            paramsType: AIParamsType.Anthropic,
            params: { model: ANTHROPIC_MODELS.OPUS, reasoning: { effort: 'high' } },
        },
        reasoningPromptMode: 'native',
        pricing: {
            inputPer1M: 5,
            outputPer1M: 25,
            ...ANTHROPIC_CACHE,
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
        reasoningPromptMode: 'native',
    },
    {
        id: 'gpt-5.4-oai',
        label: 'GPT 5.4 OAI',
        description: 'OpenAI latest OAI',
        inference: {
            paramsType: AIParamsType.OpenAI,
            params: {
                model: OPENAI_MODELS.GPT_5_4,
                reasoning: { effort: 'medium' },
                useResponsesAPI: true,
            },
        },
        reasoningPromptMode: 'native',
        pricing: {
            inputPer1M: 2.5,
            outputPer1M: 15,
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
        reasoningPromptMode: 'native',
    },
    {
        id: 'qwen',
        label: 'Qwen 3.5',
        description: 'Fast & cheap',
        inference: {
            paramsType: AIParamsType.OpenRouter,
            params: { model: COMMON_MODELS.QWEN_3_5, reasoning: true },
        },
        reasoningPromptMode: 'thinking-tags',
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
                stripImages: true,
                useResponsesAPI: true,
                // reasoning: true,
                // Use KV quant Q4 and high context
                // Q4_K_S is good
            },
        },
        reasoningPromptMode: 'thinking-tags',
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
                stripImages: true,
                // reasoning: true,
                // Q4_K_M is good
            },
        },
        reasoningPromptMode: 'thinking-tags',
    },
];

// Merge local overrides — same id replaces, new id appends
function mergePresets(base: ModelPreset[], local: ModelPreset[]): ModelPreset[] {
    const merged = base.map((p) => local.find((l) => l.id === p.id) ?? p);
    const added = local.filter((l) => !base.some((p) => p.id === l.id));
    return [...merged, ...added];
}

const MODEL_PRESETS: ModelPreset[] = LOCAL_PRESETS.length ? mergePresets(BASE_PRESETS, LOCAL_PRESETS) : BASE_PRESETS;

const FALLBACK_PRESET_ID = 'sonnet';

/** Reads DEFAULT_PRESET from env (worker or Next.js), falls back to 'sonnet' */
export function getDefaultPresetId(env?: { DEFAULT_PRESET?: string }): string {
    return env?.DEFAULT_PRESET || FALLBACK_PRESET_ID;
}

/** @deprecated Use getDefaultPresetId() — kept for existing imports during migration */
export const DEFAULT_PRESET_ID = FALLBACK_PRESET_ID;

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
    return resolveModelPreset(presetId, allowed, blocked)?.inference ?? null;
}

/**
 * Resolve a preset ID to the full preset metadata. Returns null if not found or not allowed.
 */
export function resolveModelPreset(presetId: string, allowed?: string, blocked?: string): ModelPreset | null {
    const available = getAvailablePresets(allowed, blocked);
    return available.find((p) => p.id === presetId) ?? null;
}
