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

    try {
        const userPrompt = `Document Name: ${documentName}
Document Title: ${documentTitle}`;

        const result = await runInferenceNoStream(ctx, {
            paramsType: AIParamsType.OpenRouter,
            instructions: CLASSIFICATION_PROMPT,
            context: [{ role: 'user', content: userPrompt }],
            params: {
                model: COMMON_MODELS.GEMINI_FLASH_3,
                maxTokens: 200,
            },
            schema: ClassificationResultSchema,
        });

        console.log('[document-classifier] Raw inference result:', {
            status: result.status,
            hasResult: !!result.result,
            error: result.error,
        });

        // Handle both 'success' and 'soft-error' (soft-error means JSON was repaired but still valid)
        if ((result.status === 'success' || result.status === 'soft-error') && result.result) {
            const classification = result.result as ClassificationResult;
            console.log('[document-classifier] Classification result:', {
                documentName,
                isInternalDocument: classification.isInternalDocument,
                documentType: classification.documentType,
                confidence: classification.confidence,
            });
            return classification.isInternalDocument;
        }

        // If classification failed, default to false (don't generate for unknown docs)
        console.warn('[document-classifier] Classification failed, defaulting to NO AI content:', result.status, result.error);
        return false;
    } catch (error) {
        console.error('[document-classifier] Error classifying document:', error);
        // On error, default to false (don't generate for unknown docs)
        return false;
    }
}
