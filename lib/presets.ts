import { AIParamsType, type ParamsWithType } from '@common/ai/inference/types';
import { ANTHROPIC_MODELS } from '@common/ai/types';

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

export const MODEL_PRESETS: ModelPreset[] = [
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
];

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
