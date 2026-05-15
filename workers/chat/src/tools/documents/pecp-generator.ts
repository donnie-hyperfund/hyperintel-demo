/**
 * PECP Generator — produces the PE-facing summary of an internal document.
 *
 * Runs as a separate, dedicated Anthropic call (not part of the main chat agent's tool loop).
 * Streams its output through the active SSE pipeline as `summary_*` events, and
 * writes the final text into `artifact_versions.summary_internal` on the parent version.
 *
 * The system prompt is loaded from Langfuse (slug: `pma/pecp-generator`) and compiled
 * with Handlebars — the prompt itself contains placeholders for document_type,
 * document_name, and document_content.
 */

import { ANTHROPIC_MODELS } from '@common/ai/types';
import type { EntityManager } from '@mikro-orm/core';
import { AsyncHandlebars } from 'handlebars-jle';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { SUMMARY_INTERNAL_CHAR_ESTIMATE } from '@/lib/schema/artifact';
import type { StreamEvent } from '@/lib/schema/stream';
import type { Ctx } from '../../context';
import { getPromptContent, resolveLocalPromptPath } from '../../utils/prompt-loader';

const PECP_PROMPT_SLUG = 'pma/pecp-generator';

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
    const { rCtx, em, versionId, artifactId, version, documentName, documentType, content, pushStreamEvents } = params;

    if (!rCtx.anthropic) {
        throw new Error('Anthropic client not available — cannot generate internal summary.');
    }

    const localPath = resolveLocalPromptPath();
    const rawPrompt = await getPromptContent(rCtx, PECP_PROMPT_SLUG, localPath);
    if (!rawPrompt) {
        throw new Error(`PECP generator prompt not found (slug: ${PECP_PROMPT_SLUG}).`);
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
    const resp = await rCtx.anthropic.messages.create({
        model: ANTHROPIC_MODELS.SONNET,
        max_tokens: 4096,
        system: systemPrompt,
        // The prompt itself carries the document content via Handlebars placeholders;
        // the model still needs at least one user turn to generate, so we hand it the
        // explicit "produce the deliverable" trigger.
        messages: [{ role: 'user', content: 'Produce the PE-facing deliverable now.' }],
        stream: true,
    });

    for await (const event of resp as AsyncIterable<any>) {
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
}
