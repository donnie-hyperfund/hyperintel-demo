/**
 * Intake Handler — Company Profile (CPF) & Human Persona (HPF) flows
 *
 * Returns SSE stream: first event = IDs, then generation runs inline.
 * Kept alive by GenerationProxyDO. Events delivered via UserGateway WS.
 */

import { runAgentStream } from '@common/ai/agent';
import { buildMessageUsage } from '@common/ai/agent/usage-builder';
import { extractInferenceMetadata, withCommonParams } from '@common/ai/inference';
import { ensurePricingCache } from '@common/ai/inference/openrouter-pricing';
import type { ContextMessage } from '@common/ai/inference/types';
import { PublicError } from '@common/common/error.helpers';
import { serializeException } from '@/common/ai/utils';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { getDefaultPresetId, type ReasoningPromptMode, resolveModelPreset } from '@/lib/presets';
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
import { createUserDecisionTools, type UserDecisionContext, UserDecisionToolGroup } from './tools/user-decision';
import {
    CHAT_CONTEXT_LIMIT_TOKENS,
    createContextLimitError,
    estimateInferenceInputTokens,
} from './utils/context-budget';
import { maybeRecordContextOverflow } from './utils/context-overflow';
import { resolvePricing } from './utils/cost';
import type { UserGatewayStub } from './utils/do-stubs';
import {
    buildStoredErrorMetadata,
    buildWorkerErrorLogContext,
    classifyWorkerError,
    extractRawErrorMessage,
    logWorkerError,
} from './utils/error-metadata';
import { DEFAULT_LOCAL_PROMPTS_PATH, getPromptContent, parseLocalPromptEnv } from './utils/prompt-loader';
import {
    buildReasoningVisibilityGuidance,
    getEffectiveReasoningPromptMode,
    getPresetReasoningPromptMode,
    inferReasoningPromptMode,
} from './utils/reasoning-visibility-guidance';
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

function getIntakeToolsAndGroups() {
    return {
        allTools: [...createDocumentTools(), ...createKnowledgeTools(), ...createUserDecisionTools()],
        toolGroups: [DocumentToolGroup, KnowledgeSearchToolGroup, UserDecisionToolGroup],
    };
}

async function buildIntakeSystemPrompt(
    ctx: Ctx,
    framework: 'cpf' | 'hpf',
    category: string | undefined,
    localPath: string | null = null,
    reasoningPromptMode: ReasoningPromptMode = 'internal-only',
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

    systemPrompt += `\n\n---\n\n${buildReasoningVisibilityGuidance(reasoningPromptMode)}`;

    return systemPrompt;
}

type IntakeToolsAndGroups = ReturnType<typeof getIntakeToolsAndGroups>;

type PreparedIntakeGenerationInput = IntakeToolsAndGroups & {
    contextMessages?: ContextMessage[];
    systemPrompt: string;
    estimatedTokens: number;
    reasoningPromptMode: ReasoningPromptMode;
};

async function prepareIntakeGenerationInput({
    data,
    ctx,
    chat,
    options,
}: {
    data: SendIntakeChatActionDto;
    ctx: Ctx;
    chat: ChatEntity;
    options: ChatHandlerOptions;
}): Promise<PreparedIntakeGenerationInput | PublicError> {
    const { em } = ctx;
    const framework = chat.metadata?.framework as 'cpf' | 'hpf';
    const category = chat.metadata?.category as string | undefined;
    if (!framework) throw new Error('Chat metadata missing framework type');

    const historyMessages = await loadChatHistory(em!, data.chatId, ctx.env);
    const estimationContextMessages: ContextMessage[] = data.message
        ? [...historyMessages, { role: 'user', content: data.message }]
        : historyMessages;
    const localPromptsSetting = options.useLocalPrompts ?? parseLocalPromptEnv();
    const localPath = localPromptsSetting
        ? localPromptsSetting === true
            ? DEFAULT_LOCAL_PROMPTS_PATH
            : localPromptsSetting
        : null;
    const presetId = data.model ?? getDefaultPresetId(ctx.env);
    const resolvedPreset = resolveModelPreset(presetId, ctx.env.ALLOWED_PRESETS, ctx.env.BLOCKED_PRESETS);
    const defaultInference = resolvedPreset ? withCommonParams(resolvedPreset.inference, { reasoning: false }) : null;
    const reasoningPromptMode = options.overrideInference
        ? inferReasoningPromptMode(options.overrideInference)
        : defaultInference
          ? getEffectiveReasoningPromptMode(
                defaultInference,
                resolvedPreset ? getPresetReasoningPromptMode(resolvedPreset) : undefined,
            )
          : 'internal-only';

    const systemPrompt = await buildIntakeSystemPrompt(ctx, framework, category, localPath, reasoningPromptMode);
    const { allTools, toolGroups } = getIntakeToolsAndGroups();
    const estimatedTokens = estimateInferenceInputTokens({
        instructions: systemPrompt,
        context: estimationContextMessages,
        tools: allTools,
        toolGroups,
    });

    // TODO: two-gate preflight (warning/hard) not implemented here — intake keeps single-stop behavior for now.
    if (estimatedTokens > CHAT_CONTEXT_LIMIT_TOKENS) {
        return createContextLimitError(
            estimatedTokens,
            CHAT_CONTEXT_LIMIT_TOKENS,
            'This conversation has reached the context limit. Start a new conversation before continuing.',
        );
    }

    return {
        allTools,
        toolGroups,
        systemPrompt,
        estimatedTokens,
        reasoningPromptMode,
        ...(data.imageFileIds?.length ? {} : { contextMessages: estimationContextMessages }),
    };
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
): Promise<IntakeActionResult | ReadableStream | Response | PublicError> {
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

    const safetyPromise = message ? safetyCheck(ctx, message) : Promise.resolve(null);

    const preparedInput = await prepareIntakeGenerationInput({ data, ctx, chat, options });
    if (preparedInput instanceof PublicError) return preparedInput;

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
            preparedInput,
            safetyPromise,
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
            await runIntakeGeneration({
                data,
                ctx,
                options,
                chat,
                agentMessageId,
                requestStartedAt,
                ugStub,
                preparedInput,
                safetyPromise,
            });
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
    preparedInput: PreparedIntakeGenerationInput;
    safetyPromise: Promise<Awaited<ReturnType<typeof safetyCheck>> | null>;
}

async function runIntakeGeneration(params: IntakeGenerationParams): Promise<void> {
    const { data, ctx, options, chat, agentMessageId, ugStub, preparedInput, safetyPromise } = params;
    const { chatId, message } = data;
    const { anthropic, langfuse, em } = ctx;

    const { streamDO, abortController, pusher } = setupStreamInfra(agentMessageId, ctx, 'intake-handler');

    try {
        if (!anthropic || (!langfuse && !options.useLocalPrompts)) {
            throw new Error(
                'Anthropic and Langfuse clients are required (langfuse can be skipped with useLocalPrompts)',
            );
        }

        const historyMessages = preparedInput.contextMessages ?? (await loadChatHistory(em!, chatId, ctx.env));
        // TODO: maybe early reject with error here if safetyVerdict.blocked
        const safetyVerdict = await safetyPromise;

        const allMessages = injectSafetyContext(historyMessages, safetyVerdict);

        // Track version IDs created during this turn
        const createdVersionIds: string[] = [];

        const userId = chat.user!.id;

        const agentCtx: DocumentToolsContext & KnowledgeSearchContext & UserDecisionContext = {
            em: em!,
            userId,
            chatId: chat.id,
            draftManager: new DraftManager(),
            createdVersionIds,
            // UserDecisionContext — request_user_decision pushes the prompt event
            // through this pusher and long-polls the DO for the user's click.
            pusher,
            streamDO,
            onVersionCreated: (event) => {
                ugStub
                    .broadcastToAll({ type: 'user_event', eventType: 'artifact_version_created', payload: event })
                    .catch(console.error);
            },
        };

        // Refresh OpenRouter pricing cache if stale (non-blocking background fetch)
        if (ctx.orouterSdk) ensurePricingCache(ctx.orouterSdk);

        const presetId = data.model ?? getDefaultPresetId(ctx.env);
        const resolvedPreset = resolveModelPreset(presetId, ctx.env.ALLOWED_PRESETS, ctx.env.BLOCKED_PRESETS);
        if (!resolvedPreset) {
            throw new Error(`Preset '${presetId}' is not available`);
        }
        const defaultInference = withCommonParams(resolvedPreset.inference, { reasoning: false });
        const inferenceParams = options.overrideInference ?? defaultInference;

        const { allTools, systemPrompt, toolGroups } = preparedInput;

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
                    behavioralGuidance: [
                        'DECISION ESCALATION: Use `request_user_decision` for GENUINE ambiguity only — multiple valid paths where the user must pick (project type at ambiguous initiation, persona disambiguation, framework branching, deliverable type, intent ambiguity, tool errors with multiple named recovery paths). Do NOT silently pick yourself, and do NOT ask in plain text when concrete options exist. FORBIDDEN: (1) refusal-disguise — presenting alternatives when the user already gave an unambiguous command (that is Authority Inversion in tool-call form; if execution is blocked, say so plainly); (2) false ambiguity — asking about details a competent SME can reasonably default. Pre-flight test: "Could a competent SME proceed without clarification?" If yes, proceed. After the user clicks, act on the choice immediately without re-confirming.',
                    ],
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
            docEventsCtx: { em: em!, draftManager: agentCtx.draftManager },
            commonEventOpts: {
                isCurrentDraftInternal: () => agentCtx.draftManager.getCurrent()?.is_internal === true,
            },
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
                            ? buildStoredErrorMetadata({
                                  classification: event.error!.classification,
                                  requestId: ctx.requestId,
                              })
                            : null;
                        if (isError) {
                            logWorkerError(
                                'intake-handler',
                                buildWorkerErrorLogContext({
                                    classification: event.error!.classification,
                                    stage: 'done_ext',
                                    chatId,
                                    agentMessageId,
                                    requestId: ctx.requestId,
                                    error: event.error!.raw,
                                }),
                                event.error!.raw,
                            );
                            maybeRecordContextOverflow(
                                chat,
                                event.error!.classification,
                                preparedInput.estimatedTokens,
                            );
                        }

                        // --- Cost calculation from apiUsage ---
                        const apiUsage = event.apiUsage;
                        let messageUsage: ReturnType<typeof buildMessageUsage> = null;
                        if (apiUsage) {
                            const pricing = await resolvePricing({
                                apiUsage,
                                modelId: inferenceParams.params?.model as string | undefined,
                                presetId,
                                allowed: ctx.env.ALLOWED_PRESETS,
                                blocked: ctx.env.BLOCKED_PRESETS,
                            });
                            messageUsage = buildMessageUsage({ apiUsage, pricing });
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
                                    ...(errorMetadata && { error: errorMetadata }),
                                    ...(messageUsage && { usage: messageUsage }),
                                },
                                ...(isError && { is_error: true }),
                                ...(isAborted && { is_aborted: true }),
                                ...(Object.keys(debugData).length > 0 && { debug_data: debugData }),
                            });
                            em!.persist(assistantMsg);
                        }

                        // Flush assistant message before linking versions (FK requires row to exist)
                        chat.active_agent_message_id = null;
                        if (messageUsage?.cost != null) {
                            chat.total_cost = Number(chat.total_cost ?? 0) + messageUsage.cost;
                        }
                        await em!.flush();

                        // Link created document versions to the assistant message
                        if (assistantMsg && createdVersionIds.length > 0) {
                            await em!
                                .createQueryBuilder(ArtifactVersionEntity)
                                .update({ chat_message: assistantMsg.id })
                                .where({ id: { $in: createdVersionIds } })
                                .execute();
                        }

                        // Push terminal done event (totalCost is dev-only — matches chat-handler contract)
                        const isDev = ctx.env.ENV === 'dev';
                        // `detail` is dev-only and never persisted.
                        const devErrorDetail = isDev && isError ? extractRawErrorMessage(event.error!.raw) : undefined;
                        const wsError = errorMetadata
                            ? { ...errorMetadata, ...(devErrorDetail && { detail: devErrorDetail }) }
                            : undefined;
                        const doneEvent: StreamEvent = {
                            type: 'done',
                            ...(isDev && chat.total_cost != null && { totalCost: Number(chat.total_cost) }),
                            ...(isError && { error: errorMetadata?.code ?? 'UNKNOWN' }),
                            ...(wsError && { messageMetadata: { error: wsError } }),
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
        const classification = classifyWorkerError(error);
        const errorMetadata = buildStoredErrorMetadata({ classification, requestId: ctx.requestId });
        logWorkerError(
            'intake-handler',
            buildWorkerErrorLogContext({
                classification,
                stage: 'catch',
                chatId,
                agentMessageId,
                requestId: ctx.requestId,
                error,
            }),
            error,
        );
        maybeRecordContextOverflow(chat, classification, preparedInput.estimatedTokens);
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
