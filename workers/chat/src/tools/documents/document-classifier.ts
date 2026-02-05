/**
 * Document Classifier
 *
 * Uses a fast model via OpenRouter to classify whether a document
 * should have AI-readable content generated.
 *
 * Internal documents (should have AI-readable YAML):
 * - Genesis DNA
 * - Agent Team Specification
 * - Action Plan
 * - PSEB
 * - MID
 * - Completion Briefs
 * - Legacy DNA
 *
 * Client Deliverables (should NOT have AI-readable YAML):
 * - All other documents
 */

import { z } from 'zod';
import { AIParamsType, runInferenceNoStream } from '@common/ai/inference';
import type { Ctx } from '../../context';
import { COMMON_MODELS } from '@/common/ai/types';

const DEFAULT_MODEL = COMMON_MODELS.GEMINI_FLASH_3;
const FALLBACK_MODELS = [COMMON_MODELS.GEMINI_FLASH, COMMON_MODELS.GPT_4_1_MINI, COMMON_MODELS.CLAUDE_HAIKU];

const ClassificationResultSchema = z.object({
    isInternalDocument: z.boolean(),
    documentType: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
});

type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

const CLASSIFICATION_PROMPT = `You are a document classifier. Your job is to determine if a document is an INTERNAL working document or a CLIENT DELIVERABLE.

INTERNAL documents (should have AI-readable content generated):
- Genesis DNA - foundational project/company DNA documents
- Agent Team Specification - specs for AI agent teams
- Action Plan - strategic action plans
- PSEB - Problem Statement & Executive Brief
- MID - Market Intelligence Document
- Completion Briefs - project completion summaries
- Legacy DNA - historical DNA documents

CLIENT DELIVERABLES (should NOT have AI-readable content):
- Final reports meant for external clients
- Presentation materials
- Marketing materials
- Client-facing documentation
- Proposals and pitches

Analyze the document title and content to classify it. Consider:
1. The document title/name
2. The content structure and language
3. Whether it contains internal working notes vs polished client-ready content

Respond with a JSON object:
{
  "isInternalDocument": true/false,
  "documentType": "name of document type (e.g., 'Genesis DNA', 'Action Plan', 'Client Report')",
  "confidence": "high"/"medium"/"low"
}`;

/**
 * Attempt classification with a specific model.
 * Returns ClassificationResult on success, null on failure.
 */
async function classifyWithModel(
    ctx: Ctx,
    userPrompt: string,
    model: string,
): Promise<ClassificationResult | null> {
    try {
        const result = await runInferenceNoStream(ctx, {
            paramsType: AIParamsType.OpenRouter,
            instructions: CLASSIFICATION_PROMPT,
            context: [{ role: 'user', content: userPrompt }],
            params: {
                model,
                maxTokens: 200,
            },
            schema: ClassificationResultSchema,
        });

        // Handle both 'success' and 'soft-error' (soft-error means JSON was repaired but still valid)
        if ((result.status === 'success' || result.status === 'soft-error') && result.result) {
            return result.result as ClassificationResult;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Classify a document to determine if it should have AI-readable content generated.
 *
 * @param ctx - Worker context with OpenRouter SDK
 * @param documentName - Name/key of the document
 * @param documentTitle - Display title of the document
 * @returns Whether the document should have AI-readable content
 */
export async function shouldGenerateAiContent(
    ctx: Ctx,
    documentName: string,
    documentTitle: string,
): Promise<boolean> {
    // Quick check: if no OpenRouter SDK, default to false (don't generate AI content for safety)
    if (!ctx.orouterSdk) {
        console.warn('[document-classifier] No OpenRouter SDK available, defaulting to NO AI content');
        return false;
    }

    const userPrompt = `Document Name: ${documentName}
Document Title: ${documentTitle}`;

    const modelsToTry = [DEFAULT_MODEL, ...FALLBACK_MODELS.filter((m) => m !== DEFAULT_MODEL)];

    for (const model of modelsToTry) {
        const result = await classifyWithModel(ctx, userPrompt, model);
        if (result) {
            console.log('[document-classifier] Classification result:', {
                documentName,
                model,
                isInternalDocument: result.isInternalDocument,
                documentType: result.documentType,
                confidence: result.confidence,
            });
            return result.isInternalDocument;
        }
        console.warn(`[document-classifier] Model ${model} failed, trying fallback...`);
    }

    console.warn('[document-classifier] All models failed, defaulting to NO AI content');
    return false;
}
