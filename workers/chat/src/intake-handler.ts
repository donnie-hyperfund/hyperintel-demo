/**
 * Intake Handler — Company Profile (CPF) & Human Persona (HPF) flows
 *
 * Returns SSE stream: first event = IDs, then generation runs inline.
 * Kept alive by GenerationProxyDO. Events delivered via UserGateway WS.
 */

import { runAgentStream } from '@common/ai/agent';
import { extractInferenceMetadata, type ParamsWithType } from '@common/ai/inference';
import { serializeException } from '@/common/ai/utils';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { getDefaultPresetId, resolvePreset } from '@/lib/presets';
import type { SendIntakeChatActionDto } from '@/lib/schema/chat';
import type { StreamEvent } from '@/lib/schema/stream';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import type { ChatHandlerOptions } from './chat-handler';
import type { Ctx } from './context';
import { createNoopSafetyMonitor, createSafetyMonitor } from './safety/analyzer';
import { isOutputSafetyEnabled } from './safety/config';
import { safetyCheck } from './safety/guard';
import { finalizeSafetyMonitor, injectSafetyContext } from './safety/helpers';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { createKnowledgeTools, type KnowledgeSearchContext, KnowledgeSearchToolGroup } from './tools/knowledge-search';
import type { UserGatewayStub } from './utils/do-stubs';
import { buildPublicErrorMetadata, buildWorkerErrorLogContext, logWorkerError } from './utils/error-metadata';
import { DEFAULT_LOCAL_PROMPTS_PATH, getPromptContent, parseLocalPromptEnv } from './utils/prompt-loader';
import { createOnTurnComplete, finalizeStream, runStreamLoop, setupStreamInfra } from './utils/stream-runner';
import {
    cleanupStreamDO,
    createEnqueue,
    createSSEStream,
    loadChatHistory,
    persistErrorMessage,
} from './utils/stream-utils';

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const DOCUMENT_INSTRUCTIONS: Record<
    'cpf' | 'hpf',
    { documentType: string; namePattern: string; titlePattern: string }
> = {
    cpf: {
        documentType: 'Company Profile',
        namePattern: 'company-profile-[company-name-slug].md',
        titlePattern: '[Company Name]',
    },
    hpf: {
        documentType: 'Human Persona',
        namePattern: 'human-persona-[person-name-slug].md',
        titlePattern: '[Person Name] ([Category])',
    },
};

async function buildIntakeSystemPrompt(
    ctx: Ctx,
    framework: 'cpf' | 'hpf',
    category: string | undefined,
    localPath: string | null = null,
): Promise<string> {
    const slug = `${framework}/system-prompt`;
    const promptContent = await getPromptContent(ctx, slug, localPath);

    if (!promptContent) {
        throw new Error(`Failed to load intake system prompt: ${slug}`);
    }

    let systemPrompt = promptContent;

    // Append category context for HPF
    if (framework === 'hpf' && category) {
        const categoryDescriptions: Record<string, string> = {
            principal: 'Principal — HIAI internal leadership. Requires complete organizational map with high density.',
            champion:
                'Champion — External strategic stakeholder. Focus on strategic priorities and decision patterns with high density.',
            collaborator:
                'Collaborator — External operational contact. Focus on working preferences and communication style with standard density.',
        };
        systemPrompt += `\n\n---\n\n## PERSONA CATEGORY\n\nThe user has selected: **${categoryDescriptions[category] || category}**\n\nAdapt your discovery depth and questions accordingly.`;
    }

    // Append document creation instructions
    const docInfo = DOCUMENT_INSTRUCTIONS[framework];
    systemPrompt += `\n\n---\n\n## DOCUMENT CREATION

When you have gathered sufficient information, create the document using the document tools:

1. Call \`begin_document\` with:
   - \`name\`: \`${docInfo.namePattern}\` (lowercase, hyphens)
   - \`title\`: \`${docInfo.titlePattern}\`
   - \`mode\`: \`create\`
   - \`document_type\`: \`${docInfo.documentType}\`

2. Call \`write_document\` with the full content.

3. Call \`finalize_document\` to save. You MUST call this or the content will be lost.`;

    return systemPrompt;
}

// ============================================================================
// INTAKE HANDLER — SSE stream, generation runs inline (kept alive by GenerationProxyDO)
// ============================================================================

export interface IntakeActionResult {
    userMessageId: string;
    agentMessageId: string;
    /** Resolves when generation completes. Present when onEvent is provided. */
    generation?: Promise<void>;
}

/**
 * Intake action handler — saves user message, registers stream.
 * Returns SSE stream: first event = IDs, then generation runs inline.
 * In test mode (options.onEvent), returns IntakeActionResult directly.
 */
export async function intakeActionHandler(
    data: SendIntakeChatActionDto,
    ctx: Ctx,
    options: ChatHandlerOptions = {},
): Promise<IntakeActionResult | ReadableStream | Response> {
    const { chatId, message, imageFileIds } = data;
    const { em } = ctx;
    const requestStartedAt = new Date();

    // Pre-generate IDs
    const userMessageId = crypto.randomUUID();
    const agentMessageId = crypto.randomUUID();

    // Validate ownership — intake chat belongs directly to user
    const chat = await em!.findOneOrFail(
        ChatEntity,
        {
            id: chatId,
            type: 'intake',
            user: { clerkId: ctx.user.userId },
        },
        { populate: ['user'] },
    );

    const isNudge = message === null;

    // Nudge mode: skip user message creation, check if last message is a user message
    if (isNudge) {
        const [lastMsg] = await em!.find(
            ChatMessageEntity,
            { chat: chatId },
            { orderBy: { created_at: 'DESC' }, limit: 1 },
        );
        if (!lastMsg || lastMsg.role !== 'user') {
            return new Response(JSON.stringify({ ok: true, nudge: 'skipped' }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }
    }

    let userMsg: ChatMessageEntity | null = null;
    if (!isNudge) {
        // Save user message immediately
        userMsg = em!.create(ChatMessageEntity, {
            id: userMessageId,
            chat: chatId,
            role: 'user',
            content: message!,
            created_at: requestStartedAt,
        });
        em!.persist(userMsg);

        // Link uploaded image files to this message
        if (imageFileIds?.length) {
            const imageFiles = await em!.find(ChatMessageFileEntity, {
                id: { $in: imageFileIds },
                chat_id: chatId,
                status: 'uploaded',
                chat_message: null,
            });
            for (const file of imageFiles) {
                file.chat_message = userMsg;
            }
        }
    }

    // Set activeAgentMessageId on chat entity
    chat.active_agent_message_id = agentMessageId;
    await em!.flush();

    // Get UserGateway stub for this user
    const alias = ctx.previewAlias;
    const ugId = ctx.env.USER_GATEWAY.idFromName(branchDoName(ctx.user.userId, alias));
    const ugStub = ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;

    // Broadcast message_created so other tabs can reconcile the user message (skip for nudge)
    if (userMsg) {
        const messagePayload: Record<string, unknown> = { message: userMsg.toJSON() };
        if (data.tempId) {
            messagePayload.tempId = data.tempId;
        }
        await ugStub.systemAction(`intake:${chatId}`, 'messageCreated', messagePayload, alias ?? undefined);
    }

    // Register stream via UG → IntakeTopicHandler → ChatStream DO init
    await ugStub.systemAction(
        `intake:${chatId}`,
        'registerStream',
        {
            agentMessageId,
            userId: ctx.user.userId,
            userMessageId,
        },
        alias ?? undefined,
    );

    // --- Test mode: keep existing direct-call behavior ---
    if (options.onEvent) {
        const generationPromise = runIntakeGeneration({
            data,
            ctx,
            options,
            chat,
            agentMessageId,
            requestStartedAt,
            ugStub,
        });
        return { userMessageId, agentMessageId, generation: generationPromise };
    }

    // --- Production mode: return SSE stream (kept alive by GenerationProxyDO) ---
    return createSSEStream(async (controller) => {
        const enqueue = createEnqueue(controller);

        // First event: IDs (read by GenerationProxyDO, returned to frontend)
        enqueue({ type: 'ids', userMessageId, agentMessageId });

        // SSE keepalive — prevents Cloudflare from killing the idle connection
        const heartbeat = setInterval(() => enqueue(':keepalive'), 10_000);

        try {
            await runIntakeGeneration({ data, ctx, options, chat, agentMessageId, requestStartedAt, ugStub });
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

interface IntakeGenerationParams {
    data: SendIntakeChatActionDto;
    ctx: Ctx;
    options: ChatHandlerOptions;
    chat: ChatEntity;
    agentMessageId: string;
    requestStartedAt: Date;
    ugStub: UserGatewayStub;
}

async function runIntakeGeneration(params: IntakeGenerationParams): Promise<void> {
    const { data, ctx, options, chat, agentMessageId, ugStub } = params;
    const { chatId, message } = data;
    const { anthropic, langfuse, em } = ctx;

    const { streamDO, abortController, pusher } = setupStreamInfra(agentMessageId, ctx, 'intake-handler');

    try {
        if (!anthropic || (!langfuse && !options.useLocalPrompts)) {
            throw new Error(
                'Anthropic and Langfuse clients are required (langfuse can be skipped with useLocalPrompts)',
            );
        }

        const framework = chat.metadata?.framework as 'cpf' | 'hpf';
        const category = chat.metadata?.category as string | undefined;
        if (!framework) throw new Error('Chat metadata missing framework type');

        // Load history + safety check in parallel (doesn't slow happy path)
        // For nudge (message=null), skip safety check — the system event was injected server-side
        const [historyMessages, safetyVerdict] = await Promise.all([
            loadChatHistory(em!, chatId, ctx.env),
            message ? safetyCheck(ctx, message) : Promise.resolve(null),
        ]);

        const allMessages = injectSafetyContext(historyMessages, safetyVerdict);

        // Track version IDs created during this turn
        const createdVersionIds: string[] = [];

        const userId = chat.user!.id;

        const agentCtx: DocumentToolsContext & KnowledgeSearchContext = {
            em: em!,
            userId,
            chatId: chat.id,
            draftManager: new DraftManager(),
            createdVersionIds,
            onVersionCreated: (event) => {
                ugStub
                    .broadcastToAll({ type: 'user_event', eventType: 'artifact_version_created', payload: event })
                    .catch(console.error);
            },
        };

        // Resolve local prompts path
        const localPromptsSetting = options.useLocalPrompts ?? parseLocalPromptEnv();
        const localPath = localPromptsSetting
            ? localPromptsSetting === true
                ? DEFAULT_LOCAL_PROMPTS_PATH
                : localPromptsSetting
            : null;

        const systemPrompt = await buildIntakeSystemPrompt(ctx, framework, category, localPath);

        const presetId = data.model ?? getDefaultPresetId(ctx.env);
        const resolved = resolvePreset(presetId, ctx.env.ALLOWED_PRESETS, ctx.env.BLOCKED_PRESETS);
        if (!resolved) {
            throw new Error(`Preset '${presetId}' is not available`);
        }
        const defaultInference: ParamsWithType = {
            ...resolved,
            params: { ...resolved.params, thinking: false },
        };
        const inferenceParams = options.overrideInference ?? defaultInference;

        const allTools = [...createDocumentTools(), ...createKnowledgeTools()];
        const toolGroups = [DocumentToolGroup, KnowledgeSearchToolGroup];

        const { stream, historyPromise } = runAgentStream(
            agentCtx,
            ctx,
            {
                ...inferenceParams,
                instructions: systemPrompt,
                context: allMessages,
                countReasoningAsContent: true,
                contentThreshold: 5,
            },
            allTools,
            {
                toolGroups,
                config: {
                    maxToolCalls: 100,
                    statusUpdates: { enabled: true },
                    abortSignal: abortController.signal,
                    onTurnComplete: createOnTurnComplete(agentCtx),
                },
            },
        );

        let pendingDoneEvent: { outputType: 'text' | 'tool'; outputTool?: string } | null = null;

        const outputSafetyEnabled = isOutputSafetyEnabled(ctx.env);

        // Inline safety monitor — checks content every few seconds, aborts on leak.
        const safetyMonitor = outputSafetyEnabled
            ? createSafetyMonitor({
                  ctx,
                  userMessage: message ?? '',
                  onLeak: (result) => {
                      abortController.abort();
                      pusher.push([
                          {
                              type: 'safety_retract',
                              reason: result.category,
                              severity: result.severity,
                              evidence: result.evidence,
                          } as any,
                      ]);
                  },
              })
            : createNoopSafetyMonitor();

        await runStreamLoop({
            stream,
            push: pusher.push,
            docEventsCtx: { em: em! },
            onAgentEvent: (event) => {
                if (event.type === 'delta') {
                    safetyMonitor.appendContent(event.content);
                }
            },
            onSpecificEvent: async (event) => {
                switch (event.type) {
                    case 'done':
                        pendingDoneEvent = { outputType: event.outputType, outputTool: event.outputTool };
                        break;

                    case 'done_ext': {
                        const isError = !!event.error;
                        const isAborted = !!event.aborted;
                        const streamLog = event.streamLog;
                        const assistantContent = streamLog.fullContent ?? '';
                        const errorMetadata = isError
                            ? buildPublicErrorMetadata({
                                  error: event.error!.raw,
                                  fallbackMessage: event.error!.message,
                                  requestId: ctx.requestId,
                              })
                            : null;
                        if (isError && errorMetadata) {
                            logWorkerError(
                                'intake-handler',
                                buildWorkerErrorLogContext({
                                    error: event.error!.raw,
                                    stage: 'done_ext',
                                    chatId,
                                    agentMessageId,
                                    fallbackMessage: event.error!.message,
                                    errorMetadata,
                                }),
                                event.error!.raw,
                            );
                        }

                        // --- Persist agent message to DB (using pre-generated ID) ---
                        let assistantMsg: ChatMessageEntity | null = null;
                        if (isError || isAborted || assistantContent || streamLog.blocks.length > 0) {
                            const debugData: Record<string, unknown> = {};
                            if (event.inferenceLog) debugData.inferenceLog = event.inferenceLog;
                            if (isError) {
                                debugData.error = serializeException(event.error!.raw);
                                debugData.rawResponse = event.error!.rawResponse ?? null;
                            }

                            assistantMsg = em!.create(ChatMessageEntity, {
                                id: agentMessageId,
                                chat: chatId,
                                role: 'assistant',
                                content: assistantContent,
                                reasoning: streamLog.fullReasoning || null,
                                blocks: streamLog.blocks.length > 0 ? streamLog.blocks : null,
                                metadata: {
                                    preset: presetId,
                                    inference: extractInferenceMetadata(inferenceParams),
                                    ...(errorMetadata ?? {}),
                                },
                                ...(isError && { is_error: true }),
                                ...(isAborted && { is_aborted: true }),
                                ...(Object.keys(debugData).length > 0 && { debug_data: debugData }),
                            });
                            em!.persist(assistantMsg);
                        }

                        // Flush assistant message before linking versions (FK requires row to exist)
                        chat.active_agent_message_id = null;
                        await em!.flush();

                        // Link created document versions to the assistant message
                        if (assistantMsg && createdVersionIds.length > 0) {
                            await em!
                                .createQueryBuilder(ArtifactVersionEntity)
                                .update({ chat_message: assistantMsg.id })
                                .where({ id: { $in: createdVersionIds } })
                                .execute();
                        }

                        // Push terminal done event
                        const doneEvent: StreamEvent = {
                            type: 'done',
                            ...(isError && { error: event.error!.message }),
                            ...(errorMetadata && { messageMetadata: errorMetadata }),
                            ...(pendingDoneEvent?.outputType === 'tool' &&
                                pendingDoneEvent.outputTool && {
                                    outputType: 'tool' as const,
                                    outputTool: pendingDoneEvent.outputTool,
                                }),
                        };
                        // Drain all in-flight pushes before terminal event
                        await pusher.waitAll();
                        await streamDO.push([doneEvent], pusher.seq);
                        options.onEvent?.(doneEvent);
                        break;
                    }

                    default:
                        break;
                }
            },
            onEvent: options.onEvent,
        });

        await historyPromise;

        await finalizeSafetyMonitor(safetyMonitor, em!, agentMessageId);

        await finalizeStream(streamDO, ugStub, `intake:${chatId}`);
    } catch (error: any) {
        const errorMetadata = buildPublicErrorMetadata({ error, requestId: ctx.requestId });
        logWorkerError(
            'intake-handler',
            buildWorkerErrorLogContext({
                error,
                stage: 'catch',
                chatId,
                agentMessageId,
                errorMetadata,
            }),
            error,
        );
        await persistErrorMessage({
            em: em!,
            chatId,
            agentMessageId,
            chat,
            error,
            errorMetadata,
            label: 'intake-handler',
        });
        await cleanupStreamDO({
            pusher,
            streamDO,
            ugStub,
            topic: `intake:${chatId}`,
            error,
            errorMetadata,
        });
    }
}
