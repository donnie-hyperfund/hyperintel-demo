/**
 * Cost helpers for the chat worker.
 *
 * Resolves the best available ModelPricing for a given request:
 *   1. OpenRouter live pricing (accurate, per-model) — if the request's model
 *      is known to the cached /models catalog.
 *   2. Preset-declared pricing — fallback when OR has no entry (direct providers,
 *      local models, etc).
 *
 * Skip this entirely when the provider already reported cost (OpenRouter usage.cost) —
 * `buildMessageUsage` trusts providerCost verbatim, so pricing is unused in that path.
 */

import type { AgentApiUsage } from '@common/ai/agent/usage-types';
import { getModelPricing } from '@common/ai/inference/openrouter-pricing';
import type { ModelPricing } from '@common/ai/inference/pricing';
import { getAvailablePresets } from '@/lib/presets';

export async function resolvePricing(args: {
    apiUsage: AgentApiUsage;
    modelId: string | undefined;
    presetId: string;
    allowed: string | undefined;
    blocked: string | undefined;
}): Promise<ModelPricing | undefined> {
    // Provider already priced this — caller doesn't need pricing at all.
    if (args.apiUsage.providerCost != null) return undefined;

    const orPricing = args.modelId ? await getModelPricing(args.modelId) : undefined;
    if (orPricing) return orPricing;

    return getAvailablePresets(args.allowed, args.blocked).find((p) => p.id === args.presetId)?.pricing;
}
