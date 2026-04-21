import { runAgentStream } from '@common/ai/agent';
import { AIParamsType, type ParamsWithType, runInferenceNoStream } from '@common/ai/inference';
import { ANTHROPIC_MODELS, COMMON_MODELS } from '@common/ai/types';
import { PublicError } from '@common/common/error.helpers';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { SummarizeActionDto } from '@/lib/schema/chat';
import type { StreamEvent } from '@/lib/schema/stream';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import { chatActionHandler, type ChatActionResult, preprocessContext } from './chat-handler';
import { Ctx } from './context';
import { BlurbToolGroup, createBlurbTools } from './tools/blurb';
import { listDocuments } from './tools/documents/document-service';
import type { UserGatewayStub } from './utils/do-stubs';
import { buildPublicErrorMetadata, buildWorkerErrorLogContext, logWorkerError } from './utils/error-metadata';
import { extractDocuments } from './utils/extract-documents';
import { getPromptContent, resolveLocalPromptPath } from './utils/prompt-loader';
import { finalizeStream, runStreamLoop, setupStreamInfra } from './utils/stream-runner';
import { cleanupStreamDO, createEnqueue, createSSEStream } from './utils/stream-utils';

export interface SummarizerOptions {
    overrideInference?: ParamsWithType;
    /** Event tap — called with each StreamEvent during generation. For tests. */
    onEvent?: (event: StreamEvent) => void;
}

const SUMMARY_PREFIX = `📋 **Summary of the previous conversation**\n\n---\n\n`;

/**
 * Load summarizer prompt (pma/summarizer only).
 * Uses the same local-file / Langfuse mechanism as the chat handler.
 */
async function getSummarizerPrompt(ctx: Ctx): Promise<string> {
    const localPath = resolveLocalPromptPath();
    const summarizerPrompt = await getPromptContent(ctx, 'pma/summarizer', localPath);

    if (!summarizerPrompt) {
        throw new Error('Failed to load summarizer prompt (pma/summarizer)');
    }

    return summarizerPrompt;
}

// ============================================================================
// SUMMARIZE ACTION HANDLER — SSE stream, generation runs inline (kept alive by GenerationProxyDO)
// ============================================================================

export interface SummarizeActionResult {
    agentMessageId: string;
    /** Resolves when generation completes. Present when onEvent is provided. */
    generation?: Promise<void>;
}

/**
 * Summarize action handler — registers stream under chat:{chatId} topic.
 * Returns SSE stream: first event = IDs, then generation runs inline.
 * In test mode (options.onEvent), returns SummarizeActionResult directly.
 */
export async function summarizeActionHandler(
    data: SummarizeActionDto,
    ctx: Ctx,
    options: SummarizerOptions = {},
): Promise<SummarizeActionResult | ReadableStream | PublicError> {
    const { chatId } = data;
    const { em } = ctx;

    const agentMessageId = crypto.randomUUID();

    // Validate ownership + load chat entity
    const chat = await em!.findOneOrFail(ChatEntity, {
        id: chatId,
        project: { user: { clerkId: ctx.user.userId } },
    });

    // Gate: require an approved Completion Brief before phase transition
    if (chat.completion_brief_status !== 'approved') {
        return new PublicError(400, {
            code: 'completion_brief_not_approved',
            message: 'Cannot transition phase without an approved Completion Brief',
            details: { currentStatus: chat.completion_brief_status ?? 'none' },
        });
    }

    // Set active_agent_message_id on the source chat (same column as normal chat responses)
    chat.active_agent_message_id = agentMessageId;
    await em!.flush();

    // Register stream under chat:{chatId} topic with streamType: 'summary'
    const alias = ctx.previewAlias;
    const ugId = ctx.env.USER_GATEWAY.idFromName(branchDoName(ctx.user.userId, alias));
    const ugStub = ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;
    await ugStub.systemAction(
        `chat:${chatId}`,
        'registerStream',
        {
            agentMessageId,
            userId: ctx.user.userId,
            streamType: 'summary',
            // summarizer does not have an initiating user message
        },
        alias ?? undefined,
    );

    // --- Test mode: keep existing direct-call behavior ---
    if (options.onEvent) {
        const generationPromise = runSummarizer({
            data,
            ctx,
            options,
            chat,
            agentMessageId,
            ugStub,
        });
        return { agentMessageId, generation: generationPromise };
    }

    // --- Production mode: return SSE stream (kept alive by GenerationProxyDO) ---
    return createSSEStream(async (controller) => {
        const enqueue = createEnqueue(controller);

        // First event: IDs (read by GenerationProxyDO, returned to frontend)
        enqueue({ type: 'ids', agentMessageId });

        // SSE keepalive — prevents Cloudflare from killing the idle connection
        const heartbeat = setInterval(() => enqueue(':keepalive'), 10_000);

        try {
            await runSummarizer({ data, ctx, options, chat, agentMessageId, ugStub });
        } finally {
            clearInterval(heartbeat);
        }

        try {
            controller.close();
        } catch {
            /* already closed */
        }
    }, ctx);
}

// ============================================================================
// GENERATION — runs inline in SSE stream, pushes events to ChatStream DO
// ============================================================================

interface SummarizerParams {
    data: SummarizeActionDto;
    ctx: Ctx;
    options: SummarizerOptions;
    chat: ChatEntity;
    agentMessageId: string;
    ugStub: UserGatewayStub;
}

async function runSummarizer(params: SummarizerParams): Promise<void> {
    const { data, ctx, options, chat, agentMessageId, ugStub } = params;
    const { chatId } = data;
    const { em, anthropic } = ctx;

    const { streamDO, abortController, pusher } = setupStreamInfra(agentMessageId, ctx, 'summarizer');

    try {
        if (!anthropic) {
            throw new Error('Anthropic client required');
        }

        const messages = await em!.find(ChatMessageEntity, { chat: chatId }, { orderBy: { created_at: 'ASC' } });
        if (!messages.length) {
            throw new Error('Cannot summarize empty chat');
        }

        const phaseNumber = chat.phase_index + 1;
        const today = new Date().toISOString().split('T')[0];

        const documents = extractDocuments(messages);
        const basePrompt = await getSummarizerPrompt(ctx);

        // Reinforcement — the summary text must NOT contain Section 13 / the Next-Phase
        // Initialization Blurb. The blurb is delivered separately via the `generate_blurb`
        // terminal tool call.
        const BLURB_REINFORCEMENT = `## Summary Content Rule

The summary text (Output 1) MUST NOT contain the Next-Phase Initialization Blurb (Section 13 of the Completion Brief). Do NOT paste it, rephrase it, quote it, or include a "Next-Phase Initialization Blurb" heading followed by its content anywhere in the summary.

The blurb is delivered separately via the \`generate_blurb\` tool. After finishing the summary text, call \`generate_blurb\` EXACTLY ONCE with Section 13 copied VERBATIM as the \`blurb\` parameter — raw content only (no header, no intro phrase, no surrounding commentary). This is a TERMINAL action and ends the run.`;

        let instructions = `${basePrompt}\n\n---\n\n${BLURB_REINFORCEMENT}\n\n---\n\n## Phase Context\n\n- **Phase Number:** ${phaseNumber}\n- **Date:** ${today}`;

        if (documents.length > 0) {
            instructions += `\n\n## Documents Created During This Conversation\n\n`;
            for (const doc of documents) {
                instructions += `### ${doc.name}\n`;
                if (doc.contentPreview) {
                    instructions += `**Preview:**\n\`\`\`\n${doc.contentPreview}\n\`\`\`\n\n`;
                }
            }
        }

        // Fetch live document statuses for documents touched in this phase
        const phaseDocNames = new Set(documents.map((d) => d.name));
        if (phaseDocNames.size > 0) {
            const allDocuments = await listDocuments(em!, { projectId: chat.project!.id });
            const phaseDocuments = allDocuments.filter((d) => phaseDocNames.has(d.name));
            if (phaseDocuments.length > 0) {
                instructions += `\n\n## Current Document Statuses (this phase)\n\nThese statuses are queried from the database at the time of summarization. Users may approve or reject documents via the UI — this does NOT appear in the conversation history. Use these statuses as the source of truth.\n\n`;
                for (const doc of phaseDocuments) {
                    const status = doc.hasProposed ? 'proposed' : (doc.currentStatus ?? doc.latestStatus);
                    instructions += `- \`${doc.name}\` (${doc.title}): v${doc.latestVersion}, **${status}**\n`;
                }
            }
        }

        // Fetch the approved Completion Brief content — Section 13 (the Next-Phase Initialization Blurb)
        // is emitted separately by the agent via the `generate_blurb` terminal tool; it MUST NOT appear
        // in the summary text. The CB is attached here only as reference material.
        if (chat.completion_brief) {
            const cbArtifact = await em!.findOne(
                ArtifactEntity,
                { id: typeof chat.completion_brief === 'string' ? chat.completion_brief : chat.completion_brief.id },
                { populate: ['current_version'] },
            );
            const cbContent = cbArtifact?.current_version?.content;
            if (cbContent) {
                instructions += `\n\n## Approved Completion Brief (reference)\n\nThe following is the approved Completion Brief for this phase. Section 13 is the "Next-Phase Initialization Blurb" — use it verbatim as the \`blurb\` parameter when you call the \`generate_blurb\` tool (per the OUTPUT CONTRACT above). Do not echo it in the summary text.\n\n${cbContent}`;
            }
        }

        const historyMessages = messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            ...(m.blocks && { blocks: m.blocks }),
        }));

        // Anthropic requires conversation to end with user message for model to respond.
        historyMessages.push({
            role: 'user' as const,
            content:
                'Please provide a comprehensive summary of this conversation as your text response. Do NOT include the Next-Phase Initialization Blurb in the summary text. After the summary, call the generate_blurb tool with the Next-Phase Initialization Blurb (Section 13 of the Completion Brief) verbatim as its input.',
        });

        const inferenceParams = options.overrideInference ?? {
            paramsType: AIParamsType.Anthropic,
            params: { model: ANTHROPIC_MODELS.SONNET },
        };

        const blurbTools = createBlurbTools();

        const { stream, historyPromise } = runAgentStream(
            {},
            ctx,
            {
                ...inferenceParams,
                instructions,
                context: historyMessages,
                countReasoningAsContent: true,
                contentThreshold: 5,
            },
            blurbTools,
            {
                terminalToolNames: ['generate_blurb'],
                toolGroups: [BlurbToolGroup],
                config: {
                    preprocessContext,
                    abortSignal: abortController.signal,
                },
            },
        );

        let summaryContent = '';
        let blurbContent: string | null = null;
        let wasAborted = false;

        /** Push a status_update event to the stream DO */
        const pushStatus = (status: string) => {
            pusher.push([{ type: 'status_update', status } as StreamEvent]);
        };

        // Emit initial status before the stream loop starts
        pushStatus('generating-summary');

        await runStreamLoop({
            stream,
            push: pusher.push,
            docEventsCtx: { em: em!, projectId: chat.project!.id },
            onSpecificEvent: (event) => {
                if (event.type === 'done_ext') {
                    summaryContent = event.streamLog.fullContent ?? '';
                    wasAborted = event.aborted ?? false;
                } else if (event.type === 'done' && event.outputType === 'tool' && event.outputTool === 'generate_blurb') {
                    const input = event.finalOutput as { blurb?: unknown } | undefined;
                    if (input && typeof input.blurb === 'string' && input.blurb.trim().length > 0) {
                        blurbContent = input.blurb.trim();
                    }
                }
            },
        });

        await historyPromise;

        // ── Abort check: clean up and exit early ──
        if (wasAborted || abortController.signal.aborted) {
            chat.active_agent_message_id = null;
            await em!.flush();

            const cancellationError = new Error('Summarization cancelled');
            await cleanupStreamDO({
                pusher,
                streamDO,
                ugStub,
                topic: `chat:${chatId}`,
                error: cancellationError,
                errorMetadata: buildPublicErrorMetadata({
                    error: cancellationError,
                    requestId: ctx.requestId,
                }),
            });
            return;
        }

        // Emit finalizing status before DB persistence
        pushStatus('finalizing');

        // TODO: Can't use chat.phase_index + 1 because historical chats can trigger summarization too.
        // Once we block message sending on non-latest chats, switch to phase_index-based calculation.
        const newChat = em!.create(ChatEntity, {
            project: chat.project!.id,
            phase: chat.phase,
            phase_index: await em!.count(ChatEntity, { project: chat.project!.id }),
            metadata: {
                summarizedFrom: chatId,
                summarizedAt: new Date().toISOString(),
                documents: extractDocuments(messages),
            },
        });
        em!.persist(newChat);

        const summaryMessage = em!.create(ChatMessageEntity, {
            chat: newChat,
            role: 'assistant',
            content: SUMMARY_PREFIX + summaryContent,
        });
        em!.persist(summaryMessage);

        if (!blurbContent) {
            console.warn(
                `[summarizer] no blurb emitted by generate_blurb (chat=${chatId}) — next phase will start without an initiation prompt`,
            );
        }

        // Clear active_agent_message_id before flush (before finalize)
        chat.active_agent_message_id = null;
        await em!.flush();

        // Auto-generate a short name for the source chat if it doesn't have one
        if (!chat.name && summaryContent) {
            try {
                const docs = extractDocuments(messages).filter(
                    (d) => !d.name.toLowerCase().includes('completion brief'),
                );
                const docContext =
                    docs.length > 0
                        ? `\n\nDocuments generated during this phase:\n${docs.map((d) => `- ${d.name}`).join('\n')}`
                        : '';

                const nameResult = await runInferenceNoStream(ctx, {
                    paramsType: AIParamsType.OpenRouter,
                    instructions:
                        'You are a concise title generator for conversation phases. Given a summary and optionally a list of documents that were generated, produce a short title (4-6 words) for this phase. If documents were generated, prioritize referencing them in the title. If the phase has no meaningful content or discussion, return "Empty phase" — do not make up a title. CRITICAL: Ignore completion briefs and PECP\'s — they are generated automatically and are not relevant. CRITICAL: Never include phase numbers or phase names like "Phase 1" in the title. Return ONLY the title, no quotes, no punctuation at the end.',
                    context: [{ role: 'user', content: summaryContent + docContext }],
                    params: {
                        model: COMMON_MODELS.GEMINI_FLASH,
                        maxTokens: 30,
                    },
                });

                if (nameResult.status === 'error') {
                    throw new Error(nameResult.error?.message ?? 'Failed to generate phase name');
                }

                if (nameResult.status === 'success' && nameResult.result) {
                    chat.name = (nameResult.result as string).trim().slice(0, 100);
                    await em!.flush();
                }
            } catch (err) {
                console.error('[summarizer] failed to generate phase name:', err);
            }
        }

        // Broadcast chat_created to all user WS connections (fire-and-forget) — frontend uses this
        // to navigate to the new chat as soon as it exists.
        ugStub
            .broadcastToAll({
                type: 'user_event',
                eventType: 'chat_created',
                payload: { chatId: newChat.id, projectId: chat.project!.id },
            })
            .catch(console.error);

        // Push the summarizer's terminal done event now so the frontend can close the summary UI
        // and finalize navigation. The SSE stream is NOT closed yet — we keep it open (heartbeats
        // flow via the keepalive in summarizeActionHandler) so the Worker stays alive while the
        // next-phase generation runs below.
        await pusher.waitAll();
        await streamDO.push([{ type: 'done', newChatId: newChat.id }], pusher.seq);

        // Send the initiation blurb as a user message on the new chat via the normal chat handler.
        // It persists the user message, broadcasts messageCreated on `chat:${newChat.id}`, and runs
        // the next-phase agent generation streaming to that same topic.
        //
        // Run INLINE (not in ctx.waitUntil) — waitUntil has a ~30s grace after the Worker invocation
        // ends, which isn't enough for a full LLM generation. Inline, the summarizer's own SSE stream
        // keeps the Worker alive via the GenerationProxyDO that holds its fetch open.
        if (blurbContent) {
            try {
                const result = await chatActionHandler(
                    { chatId: newChat.id, message: blurbContent },
                    ctx,
                    { onEvent: () => {} },
                );
                const generation = (result as ChatActionResult).generation;
                if (generation) await generation;
            } catch (err) {
                console.error('[summarizer] next-phase initiation failed:', err);
            }
        }

        await finalizeStream(streamDO, ugStub, `chat:${chatId}`);
    } catch (error: any) {
        const errorMetadata = buildPublicErrorMetadata({ error, requestId: ctx.requestId });
        logWorkerError(
            'summarizer',
            buildWorkerErrorLogContext({
                error,
                stage: 'catch',
                chatId,
                agentMessageId,
                errorMetadata,
            }),
            error,
        );

        // Clear active_agent_message_id on error (summarizer has no agent message to persist)
        try {
            chat.active_agent_message_id = null;
            await em!.flush();
        } catch (saveErr) {
            logWorkerError(
                'summarizer',
                buildWorkerErrorLogContext({
                    error: saveErr,
                    stage: 'clear_active_agent_message_id',
                    chatId,
                    agentMessageId,
                    requestId: ctx.requestId,
                }),
                saveErr,
            );
        }

        await cleanupStreamDO({
            pusher,
            streamDO,
            ugStub,
            topic: `chat:${chatId}`,
            error,
            errorMetadata,
        });
    }
}
