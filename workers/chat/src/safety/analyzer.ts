/**
 * Inline Safety Analyzer
 *
 * Monitors the agent's response IN REAL-TIME during streaming.
 * Runs on a timer (setInterval) — checks accumulated content every N seconds.
 * If a leak is detected, aborts the stream immediately.
 *
 * Flow:
 * 1. Start monitoring when stream begins (startMonitoring)
 * 2. Append content deltas as they arrive (appendContent)
 * 3. Every INTERVAL_MS, check accumulated content for leaks
 * 4. If leak detected → abort stream + push safety_retract event
 * 5. Stop monitoring when stream ends (stopMonitoring)
 */

import { z } from 'zod';
import { AIParamsType, runInferenceNoStream } from '@common/ai/inference';
import { COMMON_MODELS } from '@/common/ai/types';
import { getLangfusePromptRaw } from '@worker/vendor/langfuse-prompts';
import type { Ctx } from '../context';

const DEFAULT_MODEL = COMMON_MODELS.GEMINI_FLASH_3;
const FALLBACK_MODELS = [COMMON_MODELS.GEMINI_FLASH, COMMON_MODELS.GPT_4_1_MINI];

const ANALYZER_PROMPT_SLUG = 'safety/analyzer-prompt';

/** How often to check accumulated content (ms) */
const CHECK_INTERVAL_MS = 4_000;

/** Minimum content length before first check (skip tiny responses) */
const MIN_CONTENT_LENGTH = 100;

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
    } catch {
        return null;
    }
}

// ============================================================================
// SINGLE CHECK
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
                    content: `## User message:\n${userMessage}\n\n## Agent response (so far):\n${agentResponse}`,
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

        return null;
    } catch {
        return null;
    }
}

async function runAnalysis(
    ctx: Ctx,
    userMessage: string,
    agentResponse: string,
    prompt: string,
): Promise<AnalysisResult | null> {
    const modelsToTry = [DEFAULT_MODEL, ...FALLBACK_MODELS.filter((m) => m !== DEFAULT_MODEL)];

    for (const model of modelsToTry) {
        const result = await analyzeWithModel(ctx, userMessage, agentResponse, model, prompt);
        if (result) return result;
    }

    return null;
}

// ============================================================================
// INLINE MONITOR
// ============================================================================

export interface SafetyMonitor {
    /** Call this with each content delta from the stream */
    appendContent: (delta: string) => void;
    /** Stop monitoring (call when stream ends, regardless of reason) */
    stop: () => void;
    /** Get the last analysis result (for persisting to DB) */
    getLastResult: () => AnalysisResult | null;
}

interface MonitorOptions {
    ctx: Ctx;
    userMessage: string;
    /** Called when a leak is detected — should abort the stream */
    onLeak: (result: AnalysisResult) => void;
}

/**
 * Create an inline safety monitor that checks streaming content periodically.
 *
 * Usage in runGeneration:
 *   const monitor = createSafetyMonitor({ ctx, userMessage, onLeak: (r) => { abortController.abort(); ... } });
 *   // in stream loop: monitor.appendContent(event.content);
 *   // after stream: monitor.stop();
 */
export function createSafetyMonitor(options: MonitorOptions): SafetyMonitor {
    const { ctx, userMessage, onLeak } = options;

    let accumulatedContent = '';
    let lastCheckedLength = 0;
    let isRunning = true;
    let isChecking = false;
    let lastResult: AnalysisResult | null = null;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;

    // Pre-load the prompt so first check is fast
    const promptPromise = getAnalyzerPrompt(ctx);

    async function check() {
        // Skip if: already checking, stopped, no new content, or content too short
        if (!isRunning || isChecking) return;
        if (accumulatedContent.length < MIN_CONTENT_LENGTH) return;
        if (accumulatedContent.length === lastCheckedLength) return;

        isChecking = true;
        const contentSnapshot = accumulatedContent;
        lastCheckedLength = contentSnapshot.length;

        try {
            const prompt = await promptPromise;
            if (!prompt || !isRunning) return;

            const result = await runAnalysis(ctx, userMessage, contentSnapshot, prompt);
            if (!result || !isRunning) return;

            lastResult = result;

            if (result.leaked) {
                isRunning = false;
                onLeak(result);
            }
        } catch {
        } finally {
            isChecking = false;
        }
    }

    // Start periodic checks
    if (ctx.orouterSdk) {
        intervalHandle = setInterval(check, CHECK_INTERVAL_MS);
    }

    return {
        appendContent(delta: string) {
            if (isRunning) accumulatedContent += delta;
        },
        stop() {
            isRunning = false;
            if (intervalHandle) {
                clearInterval(intervalHandle);
                intervalHandle = null;
            }
        },
        getLastResult() {
            return lastResult;
        },
    };
}
