/**
 * Internal Summary Generator — produces the PE-facing drawer brief for an internal document.
 *
 * Runs as a separate, dedicated Anthropic call (not part of the main chat agent's tool loop).
 * Streams its output through the active SSE pipeline as `summary_*` events, and
 * writes the final text into `artifact_versions.summary_internal` on the parent version.
 *
 * The system prompt is loaded from the existing Langfuse slug (`pma/pecp-generator`)
 * and compiled with Handlebars. The slug name is retained for deployment
 * compatibility; the product concept is the Internal Summary.
 */

import { ANTHROPIC_MODELS } from '@common/ai/types';
import type { EntityManager } from '@mikro-orm/core';
import { AsyncHandlebars } from 'handlebars-jle';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { SUMMARY_INTERNAL_CHAR_ESTIMATE } from '@/lib/schema/artifact';
import type { StreamEvent } from '@/lib/schema/stream';
import type { Ctx } from '../../context';
import { captureWorkerPostHogEvent } from '../../utils/posthog';
import { getPromptContent, resolveLocalPromptPath } from '../../utils/prompt-loader';

const INTERNAL_SUMMARY_PROMPT_SLUG = 'pma/pecp-generator';
const INTERNAL_SUMMARY_MAX_TOKENS = 3000;

export interface GenerateInternalSummaryParams {
    /** Worker request context (gives access to anthropic SDK, env, etc.). */
    rCtx: Ctx;
    /** Entity manager — used to persist `summary_internal` after generation completes. */
    em: EntityManager;
    /** Parent artifact_versions row ID — receives the generated summary_internal text. */
    versionId: string;
    /** Parent ArtifactEntity id — frontend artifact store identity. */
    artifactId: string;
    /** Parent version number — included in stream events for frontend bookkeeping. */
    version: number;
    /** Parent document name (e.g. genesis-dna.md). */
    documentName: string;
    /** Parent document type — passed as context to the LLM. */
    documentType: string;
    /** Full text content of the parent document. */
    content: string;
    /** Whether this version replaced a prior version that already had a PE-facing summary. */
    hadPriorSummary?: boolean;
    /**
     * Push handler for SSE events. When provided, the generator streams summary_start /
     * summary_delta / summary_complete events through it. Without it, the generator still
     * writes the result to the DB but the frontend won't see live progress.
     */
    pushStreamEvents?: (events: StreamEvent[]) => void;
}

/**
 * Generate the internal-document summary, stream it to the SSE pipeline, and persist
 * the final text on the parent version.
 *
 * Resolves once the generation has completed and DB write is flushed.
 */
export async function generateInternalSummary(params: GenerateInternalSummaryParams): Promise<void> {
    const {
        rCtx,
        em,
        versionId,
        artifactId,
        version,
        documentName,
        documentType,
        content,
        pushStreamEvents,
        hadPriorSummary,
    } = params;

    if (!rCtx.anthropic) {
        throw new Error('Anthropic client not available — cannot generate internal summary.');
    }

    const localPath = resolveLocalPromptPath();
    const rawPrompt = await getPromptContent(rCtx, INTERNAL_SUMMARY_PROMPT_SLUG, localPath);
    if (!rawPrompt) {
        throw new Error(`Internal Summary generator prompt not found (slug: ${INTERNAL_SUMMARY_PROMPT_SLUG}).`);
    }

    const hbs = new AsyncHandlebars({ interpreted: true });
    const compiled = await hbs.compile(rawPrompt);
    const systemPrompt = await compiled({
        document_type: documentType,
        document_name: documentName,
        document_content: content,
    });

    pushStreamEvents?.([
        {
            type: 'summary_start',
            artifactId,
            name: documentName,
            versionId,
            version,
            estimatedChars: SUMMARY_INTERNAL_CHAR_ESTIMATE,
        },
    ]);

    let accumulated = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens = 0;
    let cacheCreationInputTokens = 0;
    let stopReason: string | null = null;
    const startedAt = Date.now();

    const resp = await rCtx.anthropic.messages.create({
        model: ANTHROPIC_MODELS.SONNET,
        max_tokens: INTERNAL_SUMMARY_MAX_TOKENS,
        system: systemPrompt,
        // The prompt itself carries the document content via Handlebars placeholders;
        // the model still needs at least one user turn to generate, so we hand it the
        // explicit "produce the deliverable" trigger.
        messages: [{ role: 'user', content: 'Produce the bounded PE-facing drawer brief now.' }],
        stream: true,
    });

    for await (const event of resp as AsyncIterable<any>) {
        if (event.type === 'message_start') {
            const usage = event.message?.usage;
            if (usage) {
                inputTokens = usage.input_tokens ?? 0;
                cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;
                cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
            }
        }

        if (event.type === 'message_delta') {
            outputTokens = event.usage?.output_tokens ?? outputTokens;
            stopReason = event.delta?.stop_reason ?? stopReason;
        }

        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const text = event.delta.text as string;
            if (!text) continue;
            accumulated += text;
            pushStreamEvents?.([
                {
                    type: 'summary_delta',
                    artifactId,
                    name: documentName,
                    versionId,
                    version,
                    content: text,
                },
            ]);
        }
    }

    // Persist on the parent version row.
    const parentVersion = await em.findOne(ArtifactVersionEntity, { id: versionId });
    if (parentVersion) {
        parentVersion.summary_internal = accumulated;
        await em.flush();
    }

    pushStreamEvents?.([
        {
            type: 'summary_complete',
            artifactId,
            name: documentName,
            versionId,
            version,
            content: accumulated,
        },
    ]);

    rCtx.eCtx?.waitUntil(
        captureWorkerPostHogEvent(rCtx, 'worker_internal_summary_generated', rCtx.user.userId, {
            document_type: documentType,
            document_name: documentName,
            version_id: versionId,
            version,
            model: ANTHROPIC_MODELS.SONNET,
            prompt_slug: INTERNAL_SUMMARY_PROMPT_SLUG,
            max_tokens: INTERNAL_SUMMARY_MAX_TOKENS,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_read_input_tokens: cacheReadInputTokens,
            cache_creation_input_tokens: cacheCreationInputTokens,
            source_document_chars: content.length,
            summary_chars: accumulated.length,
            duration_ms: Date.now() - startedAt,
            stop_reason: stopReason,
            had_prior_summary: hadPriorSummary ?? false,
        }).catch((error) => console.error('[posthog] failed to capture Internal Summary:', error)),
    );
}
