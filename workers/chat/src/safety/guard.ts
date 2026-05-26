/**
 * Safety Guard (Cerberus)
 *
 * Pre-processing guardrail that evaluates user messages before they reach the agent.
 * Uses a fast model to detect jailbreak attempts, prompt injection, data exfiltration,
 * and other malicious activity.
 *
 * Two-level system:
 * - blocked=true  → message is rejected, agent gets refusal instruction
 * - sensitive=true → message touches protected data, agent gets boundary instruction
 *
 * Runs in parallel with prompt/history loading — doesn't slow down the happy path.
 */

import { AIParamsType, runInferenceNoStream } from '@common/ai/inference';
import { z } from 'zod';
import { COMMON_MODELS } from '@/common/ai/types';
import type { Ctx } from '../context';
import { getPromptContent } from '../utils/prompt-loader';

const DEFAULT_MODEL = COMMON_MODELS.GEMINI_FLASH_3;
const FALLBACK_MODELS = [
    COMMON_MODELS.GEMINI_FLASH,
    COMMON_MODELS.GPT_4_1_MINI,
    COMMON_MODELS.MIMO_V2,
    COMMON_MODELS.CLAUDE_HAIKU,
];
/** Max time for the entire safety check (prompt load + all model attempts). Fail-open on timeout. */
const SAFETY_CHECK_TIMEOUT_MS = 15_000;

const GUARD_PROMPT_SLUG = 'safety/guard-prompt';

// ============================================================================
// SCHEMA
// ============================================================================

const SafetyVerdictSchema = z.object({
    /** true = message should be completely BLOCKED (malicious intent) */
    blocked: z.boolean(),
    /** true = message requests access to protected/internal data (not malicious, but must be refused) */
    sensitive: z.boolean(),
    /** 0.0 - 1.0 suspicion score */
    score: z.number(),
    /** Brief reason — always provide for blocked or sensitive */
    reason: z.string().nullable(),
});

export type SafetyVerdict = z.infer<typeof SafetyVerdictSchema>;

// ============================================================================
// PROMPT LOADING
// ============================================================================

let cachedPrompt: string | null = null;

async function getGuardPrompt(ctx: Ctx): Promise<string | null> {
    if (cachedPrompt) return cachedPrompt;

    try {
        const prompt = await getPromptContent(ctx, GUARD_PROMPT_SLUG, null);
        if (prompt) cachedPrompt = prompt;
        return prompt;
    } catch {
        return null;
    }
}

// ============================================================================
// CORE
// ============================================================================

async function checkWithModel(ctx: Ctx, message: string, model: string, prompt: string): Promise<SafetyVerdict | null> {
    try {
        const result = await runInferenceNoStream(ctx, {
            paramsType: AIParamsType.OpenRouter,
            instructions: prompt,
            context: [{ role: 'user', content: message }],
            params: {
                model,
                maxTokens: 300,
            },
            schema: SafetyVerdictSchema,
        });

        if ((result.status === 'success' || result.status === 'soft-error') && result.result) {
            return result.result as SafetyVerdict;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Evaluate a user message for safety before processing.
 *
 * @returns SafetyVerdict with blocked/sensitive/score/reason, or null if all models fail (fail-open).
 */
export async function safetyCheck(ctx: Ctx, message: string): Promise<SafetyVerdict | null> {
    // Skip very short messages (greetings, confirmations)
    if (message.trim().length < 5) {
        return { blocked: false, sensitive: false, score: 0, reason: null };
    }

    // Quick check: if no OpenRouter SDK, fail open
    if (!ctx.orouterSdk) return null;

    // Wrap entire check in a timeout — a hanging API call must never block generation
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        safetyCheckInner(ctx, message).finally(() => clearTimeout(timer)),
        new Promise<null>((resolve) => {
            timer = setTimeout(() => {
                console.warn('[safetyCheck] timed out after', SAFETY_CHECK_TIMEOUT_MS, 'ms — failing open');
                resolve(null);
            }, SAFETY_CHECK_TIMEOUT_MS);
        }),
    ]);
}

async function safetyCheckInner(ctx: Ctx, message: string): Promise<SafetyVerdict | null> {
    const prompt = await getGuardPrompt(ctx);
    if (!prompt) return null;

    const modelsToTry = [DEFAULT_MODEL, ...FALLBACK_MODELS.filter((m) => m !== DEFAULT_MODEL)];

    for (const model of modelsToTry) {
        const result = await checkWithModel(ctx, message, model, prompt);
        if (result) return result;
    }

    return null;
}
