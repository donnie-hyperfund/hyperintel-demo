import { runAgentStream } from '@common/ai/agent';
import type { AgentStreamEvent } from '@common/ai/agent/types';
import { extractInferenceMetadata, type ParamsWithType } from '@common/ai/inference';
import { ensurePricingCache, getModelPricing, calculateCost } from '@common/ai/inference/openrouter-pricing';
import { COMMON_MODELS } from '@common/ai/types';
import { createEmbeddingQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { AsyncHandlebars } from 'handlebars-jle';
import { estimateContextTokens, estimateTextTokens, estimateToolTokens, serializeException } from '@/common/ai/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { getAvailablePresets, getDefaultPresetId, resolvePreset } from '@/lib/presets';
import type { MessageUsage } from '@common/ai/agent/usage-types';
import type { SendChatActionDto, TokenBreakdown, TokenUsage } from '@/lib/schema/chat';
import type { StreamEvent } from '@/lib/schema/stream';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import type { Ctx } from './context';
import { createNoopSafetyMonitor, createSafetyMonitor } from './safety/analyzer';
import { isOutputSafetyEnabled } from './safety/config';
import { safetyCheck } from './safety/guard';
import { finalizeSafetyMonitor, injectSafetyContext } from './safety/helpers';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { createKnowledgeTools, type KnowledgeSearchContext, KnowledgeSearchToolGroup } from './tools/knowledge-search';
import { createPhaseTransitionTools, PhaseTransitionToolGroup } from './tools/phase-transition';
import { createPromptTools, PromptManagementToolGroup, PromptToolsContext } from './tools/prompt-management';
import { createWebScrapeTools, type WebScrapeContext, WebScrapeToolGroup } from './tools/web-scrape';
import type { ChatStreamDOStub, UserGatewayStub } from './utils/do-stubs';
import { createDocumentEventHandler } from './utils/document-events';
import { DEFAULT_LOCAL_PROMPTS_PATH, getPromptContent, parseLocalPromptEnv } from './utils/prompt-loader';
import {
    cleanupStreamDO,
    createEnqueue,
    createEventCollector,
    createPusher,
    createSSEStream,
    handleCommonStreamEvent,
    loadChatHistory,
    persistErrorMessage,
    wireAbort,
} from './utils/stream-utils';

// ============================================================================
// CONTEXT PREPROCESSING
// ============================================================================

/** Regex for document directives injected by finalize_document */
export const DOCUMENT_DIRECTIVE_REGEX = /::document\[[^\]]+\]\{[^}]+\}/g;

/**
 * Preprocess context messages before sending to inference.
 * Strips injected content (like document directives) that the model shouldn't see.
 */
export function preprocessContext(messages: any[]): any[] {
    return messages.map((msg) => {
        // Only process assistant messages with blocks
        if (msg.role !== 'assistant' || !msg.blocks) return msg;

        // Process blocks - strip directives from text blocks
        const processedBlocks = msg.blocks
            .map((block: any) => {
                if (block.type !== 'text') return block;
                const cleanedContent = block.content?.replace(DOCUMENT_DIRECTIVE_REGEX, '').trim() ?? '';
                return { ...block, content: cleanedContent };
            })
            .filter((b: any) => b.type !== 'text' || b.content); // Remove empty text blocks

        // Also clean the content field if present
        const cleanedContent =
            typeof msg.content === 'string' ? msg.content.replace(DOCUMENT_DIRECTIVE_REGEX, '').trim() : msg.content;

        return { ...msg, blocks: processedBlocks, content: cleanedContent };
    });
}

export interface ChatHandlerOptions {
    /** Override inference params (model/provider). If not set, uses default OpenRouter config. */
    overrideInference?: ParamsWithType;
    /**
     * Load prompts from local .md files instead of Langfuse.
     * - `true` uses default path: 'zlocal/prompts/'
     * - string specifies custom path relative to project root
     */
    useLocalPrompts?: true | string;
    /** Event tap — called with each StreamEvent during generation. For tests. */
    onEvent?: (event: StreamEvent) => void;
}

export interface ChatActionResult {
    userMessageId: string;
    agentMessageId: string;
    /** Resolves when generation completes. Present when onEvent is provided. */
    generation?: Promise<void>;
}

// ============================================================================
// PMA CONFIG
// ============================================================================

/** PMA framework prompt aliases - normalized name -> Langfuse slug */
const PMA_ALIASES: Record<string, string> = {
    // Always loaded (included so tools recognize them)
    hiai_identity_framework: 'pma/identity-framework',
    identity_framework: 'pma/identity-framework',
    hiai_core_methodology: 'pma/core-methodology',
    core_methodology: 'pma/core-methodology',

    // Loadable prompts
    project_initiation_protocol: 'pma/initiation-protocol',
    execution_standards: 'pma/execution-standards',
    project_completion_protocol: 'pma/completion-protocol',

    // Short forms
    initiation_protocol: 'pma/initiation-protocol',
    completion_protocol: 'pma/completion-protocol',

    // Conceptual aliases
    discovery_protocol: 'pma/initiation-protocol',
    token_management: 'pma/execution-standards',
    research_standards: 'pma/execution-standards',
    agent_team_generation: 'pma/initiation-protocol',
    action_planning: 'pma/initiation-protocol',
    thread_completion: 'pma/completion-protocol',
    project_dna: 'pma/completion-protocol',
};

/** Human-readable display names for prompts */
const PMA_DISPLAY_NAMES: Record<string, string> = {
    'pma/identity-framework': 'HI-AI Identity Framework',
    'pma/core-methodology': 'HI-AI Core Methodology',
    'pma/initiation-protocol': 'Project Initiation Protocol',
    'pma/execution-standards': 'Execution Standards',
    'pma/completion-protocol': 'Project Completion Protocol',
};

/** Slugs that are always loaded and cannot be unloaded */
const ALWAYS_LOADED_SLUGS = new Set(['pma/identity-framework', 'pma/core-methodology']);

// Create the tools with PMA config (slugs derived from alias values)
const pmaPromptTools = createPromptTools(PMA_ALIASES, PMA_DISPLAY_NAMES, ALWAYS_LOADED_SLUGS);

// ============================================================================
// SERVER TOOLS GUIDANCE
// ============================================================================

const WEB_SEARCH_GUIDANCE = `## Web Search
You have access to web_search for real-time information. Use it when you need current data, recent events, or facts you're uncertain about.`;

// ============================================================================
// SECURITY BOUNDARY
// ============================================================================

const BOUNDARY_PROMPT_SLUG = 'safety/boundary-prompt';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Compile a Handlebars template string with the given parameters.
 */
async function compileTemplate(template: string, params?: Record<string, unknown>): Promise<string> {
    const hbsAsyncInterpreted = new AsyncHandlebars({ interpreted: true });
    const compiled = await hbsAsyncInterpreted.compile(template);
    return compiled(params ?? {});
}

const USE_SHORT_PROMPTS = false;

/**
 * Build the system prompt, fetching content for all loaded slugs.
 * @param localPath - If provided, loads from local .md files instead of Langfuse
 * @param serverToolsGuidance - Optional guidance for server-side tools (e.g., web_search)
 */
async function buildSystemPrompt(
    ctx: Ctx,
    loadedPrompts: Set<string>,
    localPath: string | null = null,
    serverToolsGuidance?: string,
): Promise<string> {
    // Base system prompt
    const systemSlug = USE_SHORT_PROMPTS ? 'pma_short/system-prompt' : 'pma/system-prompt';
    const systemPromptRaw = await getPromptContent(ctx, systemSlug, localPath);
    if (!systemPromptRaw) {
        throw new Error(`Failed to load system prompt: ${systemSlug}`);
    }
    let systemPrompt = await compileTemplate(systemPromptRaw, {});
    let allPrompts = ['pma/identity-framework', 'pma/core-methodology', ...loadedPrompts];

    if (USE_SHORT_PROMPTS) {
        allPrompts = allPrompts.map((slug) => slug.replace('pma/', 'pma_short/'));
    }

    // Fetch and append each loaded document
    for (const slug of allPrompts) {
        const content = await getPromptContent(ctx, slug, localPath);
        if (content) {
            systemPrompt += `\n\n---\n\n# ${slug.toUpperCase()}\n\n${content}`;
        }
    }

    // Append server tools guidance if provided
    if (serverToolsGuidance) {
        systemPrompt += `\n\n---\n\n${serverToolsGuidance}`;
    }

    // Security boundary — appended last so it takes precedence
    const boundary = await getPromptContent(ctx, BOUNDARY_PROMPT_SLUG, localPath);
    if (boundary) {
        systemPrompt += `\n\n---\n\n${boundary}`;
    }

    return systemPrompt;
}

// ============================================================================
// CHAT HANDLER — SSE stream, generation runs inline (kept alive by GenerationProxyDO)
// ============================================================================

/**
 * Chat action handler — saves user message, registers stream.
 * Returns SSE stream: first event = IDs, then generation runs inline.
 * In test mode (options.onEvent), returns ChatActionResult directly.
 */
export async function chatActionHandler(
    data: SendChatActionDto,
    ctx: Ctx,
    options: ChatHandlerOptions = {},
): Promise<ChatActionResult | ReadableStream | Response> {
    const { chatId, message, tempId, imageFileIds } = data;
    const { em } = ctx;
    const requestStartedAt = new Date();

    // Pre-generate IDs (Decision #36)
    const userMessageId = crypto.randomUUID();
    const agentMessageId = crypto.randomUUID();

    // Validate ownership
    const chat = await em!.findOneOrFail(ChatEntity, {
        id: chatId,
        project: { user: { clerkId: ctx.user.userId } },
    });

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
        // Save user message immediately (Decision #37)
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

    // Broadcast message_created to all subscribers (skip for nudge — event already sent)
    const alias = ctx.previewAlias;
    const ugId = ctx.env.USER_GATEWAY.idFromName(branchDoName(ctx.user.userId, alias));
    const ugStub = ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;
    if (userMsg) {
        const messagePayload: Record<string, unknown> = { message: userMsg.toJSON() };
        if (tempId) {
            messagePayload.tempId = tempId;
        }
        await ugStub.systemAction(`chat:${chatId}`, 'messageCreated', messagePayload, alias ?? undefined);
    }

    // Register stream via UG → ChatTopicHandler → ChatStream DO init
    // Pass userId so the handler can auto-subscribe the initiator to the ChatStream DO
    await ugStub.systemAction(
        `chat:${chatId}`,
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
        const generationPromise = runGeneration({
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
        // while runGeneration pushes content to ChatStreamDO (not to this SSE stream).
        const heartbeat = setInterval(() => enqueue(':keepalive'), 10_000);

        // Run generation inline — Worker stays alive because the DO reads this stream
        try {
            await runGeneration({ data, ctx, options, chat, agentMessageId, requestStartedAt, ugStub });
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

interface GenerationParams {
    data: SendChatActionDto;
    ctx: Ctx;
    options: ChatHandlerOptions;
    chat: ChatEntity;
    agentMessageId: string;
    requestStartedAt: Date;
    ugStub: UserGatewayStub;
}

async function runGeneration(params: GenerationParams): Promise<void> {
    const { data, ctx, options, chat, agentMessageId, requestStartedAt, ugStub } = params;
    const { chatId, message } = data;
    const { anthropic, langfuse, em } = ctx;

    // Get ChatStream DO stub — already initialized by registerStream above
    const alias = ctx.previewAlias;
    const streamDO = ctx.env.CHAT_STREAM_DO.get(
        ctx.env.CHAT_STREAM_DO.idFromName(branchDoName(agentMessageId, alias)),
    ) as unknown as ChatStreamDOStub;

    // Wire abort: ChatStreamDO abort → AbortController → runner's abortSignal
    const abortController = wireAbort(streamDO);

    // Fire-and-forget pusher — hoisted for catch block access
    const pusher = createPusher(streamDO, 'chat-handler');

    try {
        if (!anthropic || (!langfuse && !options.useLocalPrompts)) {
            throw new Error('Anthropic and Langfuse clients are required (langfuse can be skipped with useLocalPrompts)');
        }

        // Load history + safety check in parallel (doesn't slow happy path)
        // For nudge (message=null), skip safety check — the system event was injected server-side
        const [historyMessages, safetyVerdict] = await Promise.all([
            loadChatHistory(em!, chatId, ctx.env),
            message ? safetyCheck(ctx, message) : Promise.resolve(null),
        ]);

        const allMessages = injectSafetyContext(historyMessages, safetyVerdict);

        // Load previously loaded prompts from chat metadata
        const savedPrompts = (chat.metadata?.loadedPrompts as string[] | undefined) ?? [];

        // Create embedding queue adapter
        const embeddingQueue = createEmbeddingQueueAdapter({
            queue: ctx.env.EMBEDDING_QUEUE,
            httpEndpoint: process.env.EMBEDDING_WORKER_URL ? `${process.env.EMBEDDING_WORKER_URL}/enqueue` : undefined,
            authSecret: process.env.AUTH_SECRET,
        });

        // Track version IDs created during this turn
        const createdVersionIds: string[] = [];

        // Create combined agent context
        const agentCtx: PromptToolsContext & DocumentToolsContext & KnowledgeSearchContext = {
            loadedPrompts: new Set<string>(savedPrompts),
            em: em!,
            projectId: chat.project!.id,
            chatId: chat.id,
            draftManager: new DraftManager(),
            embeddingQueue,
            previewAlias: ctx.previewAlias,
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

        // Get initial system prompt
        const initialSystemPrompt = await buildSystemPrompt(
            ctx,
            agentCtx.loadedPrompts,
            localPath,
            WEB_SEARCH_GUIDANCE,
        );

        // Refresh OpenRouter pricing cache if stale (non-blocking background fetch)
        if (ctx.orouterSdk) ensurePricingCache(ctx.orouterSdk);

        // Determine inference params via preset resolution
        const presetId = data.model ?? getDefaultPresetId(ctx.env);
        const resolved = resolvePreset(presetId, ctx.env.ALLOWED_PRESETS, ctx.env.BLOCKED_PRESETS);
        if (!resolved) {
            throw new Error(`Preset '${presetId}' is not available`);
        }
        const defaultInference: ParamsWithType = {
            ...resolved,
            params: { ...resolved.params, searchEnabled: true },
        };
        const inferenceParams = options.overrideInference ?? defaultInference;

        // Define tools and tool groups
        const allTools = [
            ...pmaPromptTools,
            ...createDocumentTools(),
            ...createKnowledgeTools(),
            ...createWebScrapeTools(),
            ...createPhaseTransitionTools(),
        ];
        const toolGroups = [
            PromptManagementToolGroup,
            DocumentToolGroup,
            KnowledgeSearchToolGroup,
            WebScrapeToolGroup,
            PhaseTransitionToolGroup,
        ];

        // Run the agent with streaming
        const { stream, historyPromise } = runAgentStream(
            agentCtx,
            ctx,
            {
                ...inferenceParams,
                instructions: initialSystemPrompt,
                context: allMessages,
                countReasoningAsContent: true,
                contentThreshold: 5,
            },
            allTools,
            {
                toolGroups,
                terminalToolNames: ['generate_summary'],
                config: {
                    maxToolCalls: 100,
                    getSystemPrompt: async () =>
                        buildSystemPrompt(ctx, agentCtx.loadedPrompts, localPath, WEB_SEARCH_GUIDANCE),
                    statusUpdates: { enabled: true },
                    preprocessContext,
                    abortSignal: abortController.signal,
                    onTurnComplete: () => {
                        if (agentCtx.draftManager.hasActive()) {
                            return 'You have an unfinalized document draft. You MUST call finalize_document now or the content will be lost.';
                        }
                        if (agentCtx.pendingPECP) {
                            const p = agentCtx.pendingPECP;
                            return `You MUST generate a PECP for "${p.parentDocumentType}". Call begin_document with mode="create", name="${p.pecpKey}", document_type="PECP", parent_document="${p.parentDocument}", is_internal=false. Write the PE-facing communication using the appropriate PECP stage template from your system prompt, then finalize.`;
                        }
                        return null;
                    },
                },
            },
        );

        // Event collector for DO push (replaces SSE enqueue)
        const collector = createEventCollector();
        const state = { wasTool: false };
        let pendingDoneEvent: { outputType: 'text' | 'tool'; outputTool?: string; finalOutput?: unknown } | null = null;

        const fireAndForgetPush = pusher.push;

        const outputSafetyEnabled = isOutputSafetyEnabled(ctx.env);

        // Inline safety monitor — checks content every few seconds, aborts on leak.
        // When disabled, keep the same call sites but swap in a no-op monitor.
        const safetyMonitor = outputSafetyEnabled
            ? createSafetyMonitor({
                  ctx,
                  userMessage: message ?? '',
                  onLeak: (result) => {
                      abortController.abort();
                      // Push retract event to frontend
                      fireAndForgetPush([
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

        // Document events queue — batched into the main push instead of separate RPCs
        const pendingDocEvents: StreamEvent[] = [];
        const docEvents = createDocumentEventHandler({ em: em!, projectId: agentCtx.projectId }, (docEvent) => {
            const se = docEvent as StreamEvent;
            pendingDocEvents.push(se);
            options.onEvent?.(se);
        });

        // Stream loop — push events to ChatStream DO instead of SSE
        for await (const event of stream) {
            // Feed content deltas to safety monitor
            if (event.type === 'delta') {
                safetyMonitor.appendContent(event.content);
            }

            // Forward tool_call_complete to onEvent only (not to frontend/DO)
            if (event.type === 'tool_call_complete' && options.onEvent) {
                options.onEvent({ type: 'tool_call_complete', tool: event.tool, id: event.id, input: event.input });
            }

            // Let document handler process the event (queues doc events locally)
            await docEvents.handle(event);

            // Delegate common events to collector
            if (handleCommonStreamEvent(collector.enqueue, event, state)) {
                const events = collector.drain();
                // Combine queued doc events + main events into a single push
                const combined = [...pendingDocEvents.splice(0), ...events];
                if (combined.length > 0) {
                    fireAndForgetPush(combined);
                    if (options.onEvent) events.forEach((e) => options.onEvent!(e));
                }
                continue;
            }

            // Flush any doc events that weren't paired with a main event
            if (pendingDocEvents.length > 0) {
                fireAndForgetPush(pendingDocEvents.splice(0));
            }

            // Chat-specific events
            switch (event.type) {
                case 'done':
                    pendingDoneEvent = {
                        outputType: event.outputType,
                        outputTool: event.outputTool,
                        finalOutput: event.finalOutput,
                    };
                    break;

                case 'done_ext': {
                    const isError = !!event.error;
                    const isAborted = !!event.aborted;
                    const streamLog = event.streamLog;
                    const assistantContent = streamLog.fullContent ?? '';

                    // --- Cost calculation from apiUsage ---
                    const apiUsage = event.apiUsage;
                    let messageUsage: MessageUsage | null = null;

                    if (apiUsage && (apiUsage.totalInputTokens > 0 || apiUsage.totalOutputTokens > 0)) {
                        let totalCost: number | undefined;

                        if (apiUsage.providerCost != null) {
                            totalCost = apiUsage.providerCost;
                        } else {
                            // Try OpenRouter cached pricing (accurate, per-model from API)
                            const modelId = inferenceParams.params?.model as string | undefined;
                            const orPricing = modelId ? await getModelPricing(modelId) : undefined;
                            if (orPricing) {
                                totalCost = calculateCost(orPricing, {
                                    inputTokens: apiUsage.totalInputTokens,
                                    outputTokens: apiUsage.totalOutputTokens,
                                    reasoningTokens: apiUsage.totalReasoningTokens,
                                    cacheReadTokens: apiUsage.cacheReadTokens,
                                    cacheWriteTokens: apiUsage.cacheWriteTokens,
                                });
                            } else {
                                // Fallback to preset-defined pricing
                                const preset = getAvailablePresets(ctx.env.ALLOWED_PRESETS, ctx.env.BLOCKED_PRESETS)
                                    .find(p => p.id === presetId);
                                if (preset?.pricing) {
                                    totalCost =
                                        (apiUsage.totalInputTokens * preset.pricing.inputPer1M / 1_000_000) +
                                        (apiUsage.totalOutputTokens * preset.pricing.outputPer1M / 1_000_000);
                                }
                            }
                        }

                        messageUsage = {
                            inputTokens: apiUsage.totalInputTokens,
                            outputTokens: apiUsage.totalOutputTokens,
                            ...(apiUsage.totalReasoningTokens && { reasoningTokens: apiUsage.totalReasoningTokens }),
                            ...(apiUsage.cacheReadTokens && { cacheReadTokens: apiUsage.cacheReadTokens }),
                            ...(apiUsage.cacheWriteTokens && { cacheWriteTokens: apiUsage.cacheWriteTokens }),
                            ...(totalCost != null && { cost: totalCost }),
                            segments: apiUsage.segments,
                            providerIds: apiUsage.providerIds,
                        };
                    }

                    // --- Persist agent message to DB (using pre-generated ID) ---
                    let assistantMsg: ChatMessageEntity | null = null;
                    const msgMetadata = {
                        preset: presetId,
                        inference: extractInferenceMetadata(inferenceParams),
                        ...(isError && { error: event.error!.message }),
                        ...(messageUsage && { usage: messageUsage }),
                    };

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
                            metadata: msgMetadata,
                            ...(isError && { is_error: true }),
                            ...(isAborted && { is_aborted: true }),
                            ...(Object.keys(debugData).length > 0 && { debug_data: debugData }),
                        });
                        em!.persist(assistantMsg);
                    }

                    // Calculate token usage estimates
                    let usedContextTokens = estimateContextTokens(allMessages);
                    if (assistantContent) usedContextTokens += estimateTextTokens(assistantContent);
                    if (streamLog.fullReasoning) usedContextTokens += estimateTextTokens(streamLog.fullReasoning);
                    for (const block of streamLog.blocks) {
                        if (block.type === 'tool_call') {
                            usedContextTokens += estimateTextTokens(block.toolName);
                            usedContextTokens += estimateTextTokens(
                                typeof block.toolInput === 'string' ? block.toolInput : JSON.stringify(block.toolInput),
                            );
                            if (block.toolOutput) usedContextTokens += estimateTextTokens(block.toolOutput);
                        }
                    }

                    const usedPromptTokens = estimateTextTokens(initialSystemPrompt);
                    const toolTokens = estimateToolTokens(allTools, toolGroups);
                    const usedTokens = usedContextTokens + usedPromptTokens + toolTokens.toolDefTokens;
                    const tokenBreakdown: TokenBreakdown = {
                        context: usedContextTokens,
                        prompt: usedPromptTokens,
                        promptTool: toolTokens.promptToolTokens,
                        toolDef: toolTokens.toolDefTokens,
                    };

                    // Update chat metadata + clear activeAgentMessageId
                    chat.metadata = {
                        ...chat.metadata,
                        loadedPrompts: Array.from(agentCtx.loadedPrompts),
                    };
                    chat.token_usage = { tokenBreakdown, usedTokens };
                    if (messageUsage?.cost != null) {
                        chat.total_cost = Number(chat.total_cost ?? 0) + messageUsage.cost;
                    }
                    chat.active_agent_message_id = null;

                    // Save safety verdict to user message debug_data
                    if (safetyVerdict && safetyVerdict.score > 0) {
                        // Find the user message we just persisted (last user msg in chat)
                        const userMsgs = await em!.find(
                            ChatMessageEntity,
                            { chat: chatId, role: 'user' },
                            { orderBy: { created_at: 'DESC' }, limit: 1 },
                        );
                        if (userMsgs[0]) {
                            userMsgs[0].debug_data = {
                                ...((userMsgs[0].debug_data as Record<string, unknown>) ?? {}),
                                safetyVerdict,
                            };
                        }
                    }

                    // Flush assistant message before linking versions (FK requires row to exist)
                    await em!.flush();

                    // Link created document versions to the assistant message
                    if (assistantMsg && createdVersionIds.length > 0) {
                        await em!
                            .createQueryBuilder(ArtifactVersionEntity)
                            .update({ chat_message: assistantMsg.id })
                            .where({ id: { $in: createdVersionIds } })
                            .execute();
                    }

                    let hasPendingChanges = false;
                    const phaseIndex = chat.phase_index;

                    if (chat.project) {
                        const artifacts = await em!.find(
                            ArtifactEntity,
                            { versions: { chat: chatId } },
                            { populate: ['versions'] },
                        );
                        hasPendingChanges = artifacts.some((artifact) =>
                            artifact.versions.getItems().some((v) => v.status === 'proposed'),
                        );
                    }

                    // Push terminal done event to DO (subscriber gets it via broadcast)
                    const isDev = ctx.env.ENV === 'dev';

                    // Build safe message metadata for WS delivery (no error, safetyAnalysis, etc.)
                    // Only include dev-only fields (preset, inference, usage) in dev mode
                    const safeMessageMetadata: Record<string, unknown> | undefined = isDev ? {
                        ...(msgMetadata.preset && { preset: msgMetadata.preset }),
                        ...(msgMetadata.inference && { inference: msgMetadata.inference }),
                        ...(msgMetadata.usage && { usage: msgMetadata.usage }),
                    } : undefined;

                    const doneEvent: StreamEvent = {
                        type: 'done',
                        tokenUsage: { tokenBreakdown, usedTokens },
                        ...(isDev && chat.total_cost != null && { totalCost: chat.total_cost }),
                        ...(safeMessageMetadata && Object.keys(safeMessageMetadata).length > 0 && { messageMetadata: safeMessageMetadata }),
                        hasPendingChanges,
                        phaseIndex,
                        ...(isError && { error: event.error!.message }),
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
                    // TODO
                    break;
            }
        }

        await historyPromise;

        await finalizeSafetyMonitor(safetyMonitor, em!, agentMessageId);

        // done() → persist (above) → finalize() → clearStream (Decision #20)
        try {
            await streamDO.done();
            await streamDO.finalize();
        } finally {
            await ugStub.systemAction(`chat:${chatId}`, 'clearStream', {}).catch(() => {});
        }
    } catch (error: any) {
        console.error('[chat-handler] generation error:', error?.message ?? error, error?.stack);
        await persistErrorMessage(em!, chatId, agentMessageId, chat, error, 'chat-handler');
        await cleanupStreamDO(pusher, streamDO, ugStub, `chat:${chatId}`, error);
    }
}
