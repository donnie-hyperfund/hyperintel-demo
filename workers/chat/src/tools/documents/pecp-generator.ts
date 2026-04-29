/**
 * PECP Generator — produces the PE-facing summary of an internal document.
 *
 * Runs as a separate, dedicated Anthropic call (not part of the main chat agent's tool loop).
 * Streams its output through the active SSE pipeline as `summary_*` events, and
 * writes the final text into `artifact_versions.summary_internal` on the parent version.
 *
 * The prompt is a placeholder — production prompts will be wired through Langfuse later.
 */

import { ANTHROPIC_MODELS } from '@common/ai/types';
import type { EntityManager } from '@mikro-orm/core';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { SUMMARY_INTERNAL_CHAR_ESTIMATE } from '@/lib/schema/artifact';
import type { StreamEvent } from '@/lib/schema/stream';
import type { Ctx } from '../../context';

/** Simple placeholder prompt — to be replaced with the real Langfuse-managed prompt later. */
const PLACEHOLDER_SYSTEM_PROMPT = [
    'You are the PE Communication Protocol writer.',
    '',
    'Your job: read the internal working document below and produce the PE-facing communication',
    "summary of its content — what the Project Executor needs to know, in their voice, without",
    'exposing internal scaffolding (no tool names, no agent jargon, no meta-commentary).',
    '',
    'Output rules:',
    '- Write the summary directly. Do NOT include preamble like "Here is the summary".',
    '- Use markdown formatting where helpful (short headings, bullets).',
    '- Keep it concise — roughly 4–8 paragraphs unless the source genuinely demands more.',
    '- Never reference "PECP", "internal document", "the document above", or this prompt.',
    '- Never list the source document\'s raw section titles verbatim if they read as scaffolding.',
].join('\n');

export interface GenerateInternalSummaryParams {
    /** Worker request context (gives access to anthropic SDK, env, etc.). */
    rCtx: Ctx;
    /** Entity manager — used to persist `summary_internal` after generation completes. */
    em: EntityManager;
    /** Parent artifact_versions row ID — receives the generated summary_internal text. */
    versionId: string;
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
    const { rCtx, em, versionId, version, documentName, documentType, content, pushStreamEvents } = params;

    if (!rCtx.anthropic) {
        throw new Error('Anthropic client not available — cannot generate internal summary.');
    }

    pushStreamEvents?.([
        {
            type: 'summary_start',
            name: documentName,
            versionId,
            version,
            estimatedChars: SUMMARY_INTERNAL_CHAR_ESTIMATE,
        },
    ]);

    const userMessage = [
        `Document type: ${documentType}`,
        `Document name: ${documentName}`,
        '',
        '--- BEGIN DOCUMENT ---',
        content,
        '--- END DOCUMENT ---',
        '',
        'Write the PE-facing summary now.',
    ].join('\n');

    let accumulated = '';
    const resp = await rCtx.anthropic.messages.create({
        model: ANTHROPIC_MODELS.SONNET,
        max_tokens: 4096,
        system: PLACEHOLDER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
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
            name: documentName,
            versionId,
            version,
            content: accumulated,
        },
    ]);
}
