/**
 * Post-processing Safety Analyzer
 *
 * Runs AFTER the agent responds — checks if the agent leaked protected information.
 * Executes async (doesn't block the user response).
 *
 * TODO: When websockets are implemented, send a "retract" event to the frontend
 * so it can hide/redact the leaked message in real-time instead of just flagging.
 */

import { z } from 'zod';
import { AIParamsType, runInferenceNoStream } from '@common/ai/inference';
import { COMMON_MODELS } from '@/common/ai/types';
import { getLangfusePromptRaw } from '@worker/vendor/langfuse-prompts';
import type { Ctx } from '../context';

const DEFAULT_MODEL = COMMON_MODELS.GEMINI_FLASH_3;
const FALLBACK_MODELS = [COMMON_MODELS.GEMINI_FLASH, COMMON_MODELS.GPT_4_1_MINI];

const ANALYZER_PROMPT_SLUG = 'safety/analyzer-prompt';

// ============================================================================
// SCHEMA
// ============================================================================

const AnalysisResultSchema = z.object({
    /** true = the agent's response contains leaked protected information */
    leaked: z.boolean(),
    /** What was leaked */
    category: z.enum([
        'internal_document_content',
        'system_prompt',
        'infrastructure',
        'ai_content_yaml',
        'debug_data',
        'none',
    ]),
    /** How severe the leak is */
    severity: z.enum(['none', 'low', 'medium', 'high', 'critical']),
    /** Short quote or description of what was leaked */
    evidence: z.string().nullable(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// ============================================================================
// PROMPT LOADING
// ============================================================================

let cachedPrompt: string | null = null;

async function getAnalyzerPrompt(ctx: Ctx): Promise<string | null> {
    if (cachedPrompt) return cachedPrompt;

    try {
        const prompt = await getLangfusePromptRaw(ctx.langfuse!, ANALYZER_PROMPT_SLUG, ctx.env);
        if (prompt) cachedPrompt = prompt;
        return prompt;
    } catch (err) {
        console.warn('[safety-analyzer] Failed to load prompt from Langfuse:', err);
        return null;
    }
}

// ============================================================================
// CORE
// ============================================================================

async function analyzeWithModel(
    ctx: Ctx,
    userMessage: string,
    agentResponse: string,
    model: string,
    prompt: string,
): Promise<AnalysisResult | null> {
    try {
        const result = await runInferenceNoStream(ctx, {
            paramsType: AIParamsType.OpenRouter,
            instructions: prompt,
            context: [
                {
                    role: 'user',
                    content: `## User message:\n${userMessage}\n\n## Agent response:\n${agentResponse}`,
                },
            ],
            params: {
                model,
                maxTokens: 300,
            },
            schema: AnalysisResultSchema,
        });

        if ((result.status === 'success' || result.status === 'soft-error') && result.result) {
            return result.result as AnalysisResult;
        }

        console.warn(`[safety-analyzer] ${model} returned ${result.status}:`, result.error);
        return null;
    } catch (err) {
        console.warn(`[safety-analyzer] ${model} threw:`, err);
        return null;
    }
}

/**
 * Analyze the agent's response for leaked protected information.
 * Runs async — does not block the user response.
 *
 * @returns AnalysisResult or null if all models fail.
 */
export async function analyzeResponse(
    ctx: Ctx,
    userMessage: string,
    agentResponse: string,
): Promise<AnalysisResult | null> {
    // Skip empty or very short responses
    if (!agentResponse || agentResponse.trim().length < 20) {
        return null;
    }

    if (!ctx.orouterSdk) {
        console.warn('[safety-analyzer] No OpenRouter SDK available, skipping analysis');
        return null;
    }

    // Load prompt from Langfuse
    const prompt = await getAnalyzerPrompt(ctx);
    if (!prompt) {
        console.warn('[safety-analyzer] No prompt available, skipping analysis');
        return null;
    }

    const modelsToTry = [DEFAULT_MODEL, ...FALLBACK_MODELS.filter((m) => m !== DEFAULT_MODEL)];

    for (const model of modelsToTry) {
        const result = await analyzeWithModel(ctx, userMessage, agentResponse, model, prompt);
        if (result) {
            console.log('[safety-analyzer] Result:', {
                model,
                leaked: result.leaked,
                category: result.category,
                severity: result.severity,
                evidence: result.evidence,
            });
            return result;
        }
        console.warn(`[safety-analyzer] Model ${model} failed, trying fallback...`);
    }

    console.warn('[safety-analyzer] All models failed');
    return null;
}
