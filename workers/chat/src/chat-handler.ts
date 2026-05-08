import { runAgentStream } from '@common/ai/agent';
import { buildMessageUsage } from '@common/ai/agent/usage-builder';
import { extractInferenceMetadata, type ParamsWithType, withCommonParams } from '@common/ai/inference';
import { ensurePricingCache } from '@common/ai/inference/openrouter-pricing';
import type { ContextMessage } from '@common/ai/inference/types';
import { ErrorStatus, PublicError } from '@common/common/error.helpers';
import { AsyncHandlebars } from 'handlebars-jle';
import { estimateContextTokens, estimateTextTokens, estimateToolTokens, serializeException } from '@/common/ai/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { getDefaultPresetId, type ReasoningPromptMode, resolveModelPreset } from '@/lib/presets';
import type { SendChatActionDto, TokenBreakdown } from '@/lib/schema/chat';
import type { StreamEvent } from '@/lib/schema/stream';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import { handleForceBrief } from './chat-brief-handler';
import type { Ctx } from './context';
import { createNoopSafetyMonitor, createSafetyMonitor } from './safety/analyzer';
import { isOutputSafetyEnabled } from './safety/config';
import { safetyCheck } from './safety/guard';
import { finalizeSafetyMonitor, injectSafetyContext } from './safety/helpers';
import { CompletionBriefToolGroup, createCompletionBriefTools } from './tools/completion-brief';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { createKnowledgeTools, type KnowledgeSearchContext, KnowledgeSearchToolGroup } from './tools/knowledge-search';
import { createPhaseTransitionTools, PhaseTransitionToolGroup } from './tools/phase-transition';
import { createPromptTools, PromptManagementToolGroup, PromptToolsContext } from './tools/prompt-management';
import { createUserDecisionTools, type UserDecisionContext, UserDecisionToolGroup } from './tools/user-decision';
import { createWebScrapeTools, WebScrapeToolGroup } from './tools/web-scrape';
import { looksLikeCompletionBriefIntent } from './utils/cb-intent';
import { estimateInferenceInputTokens } from './utils/context-budget';
import { buildContextGateError } from './utils/context-gate-error';
import { type ContextOverflowState, evaluateContextGate, maybeRecordContextOverflow } from './utils/context-overflow';
import { resolvePricing } from './utils/cost';
import type { UserGatewayStub } from './utils/do-stubs';
import {
    buildStoredErrorMetadata,
    buildWorkerErrorLogContext,
    classifyWorkerError,
    extractRawErrorMessage,
    logWorkerError,
} from './utils/error-metadata';
import { pickInferenceParams } from './utils/pick-inference-params';
import { captureWorkerPostHogEvent } from './utils/posthog';
import { preprocessContext } from './utils/preprocess-context';
import { DEFAULT_LOCAL_PROMPTS_PATH, getPromptContent, parseLocalPromptEnv } from './utils/prompt-loader';
import {
    buildReasoningVisibilityGuidance,
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
    /** Set when a user message was persisted. Absent for force-brief States A/C (summarize-only — no user input). */
    userMessageId?: string;
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
    completion_brief: 'pma/completion-brief',

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
    'pma/completion-brief': 'Completion Brief Template',
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

const COMPLETION_BRIEF_GUIDANCE = `## Completion Briefs
Before generating a Completion Brief, always call the \`completion_brief\` tool first. It loads the template and provides current phase context and document statuses.`;

function buildServerToolsGuidance(reasoningPromptMode: ReasoningPromptMode): string {
    return `${WEB_SEARCH_GUIDANCE}\n\n${COMPLETION_BRIEF_GUIDANCE}\n\n${buildReasoningVisibilityGuidance(reasoningPromptMode)}`;
}

// ============================================================================
// SECURITY BOUNDARY
// ============================================================================

const BOUNDARY_PROMPT_SLUG = 'safety/boundary-prompt';

// ============================================================================
// HELPERS
// ============================================================================

function getChatToolsAndGroups() {
    return {
        allTools: [
            ...pmaPromptTools,
            ...createCompletionBriefTools(),
            ...createDocumentTools(),
            ...createKnowledgeTools(),
            ...createWebScrapeTools(),
            ...createPhaseTransitionTools(),
            ...createUserDecisionTools(),
        ],
        toolGroups: [
            PromptManagementToolGroup,
            CompletionBriefToolGroup,
            DocumentToolGroup,
            KnowledgeSearchToolGroup,
            WebScrapeToolGroup,
            PhaseTransitionToolGroup,
            UserDecisionToolGroup,
        ],
    };
}

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

type ChatToolsAndGroups = ReturnType<typeof getChatToolsAndGroups>;

export type PreparedChatGenerationInput = ChatToolsAndGroups & {
    contextMessages?: ContextMessage[];
    initialSystemPrompt: string;
    localPath: string | null;
    estimatedTokens: number;
    reasoningPromptMode?: ReasoningPromptMode;
};

export async function prepareChatGenerationInput({
    data,
    ctx,
    chat,
    options,
}: {
    data: SendChatActionDto;
    ctx: Ctx;
    chat: ChatEntity;
    options: ChatHandlerOptions;
}): Promise<PreparedChatGenerationInput | PublicError> {
    const { em } = ctx;
    const historyMessages = await loadChatHistory(em!, data.chatId, ctx.env);
    const estimationContextMessages: ContextMessage[] = data.message
        ? [...historyMessages, { role: 'user', content: data.message }]
        : historyMessages;

    const savedPrompts = (chat.metadata?.loadedPrompts as string[] | undefined) ?? [];
    const localPromptsSetting = options.useLocalPrompts ?? parseLocalPromptEnv();
    const localPath = localPromptsSetting
        ? localPromptsSetting === true
            ? DEFAULT_LOCAL_PROMPTS_PATH
            : localPromptsSetting
        : null;

    const presetId = data.model ?? getDefaultPresetId(ctx.env);
    const resolvedPreset = resolveModelPreset(presetId, ctx.env.ALLOWED_PRESETS, ctx.env.BLOCKED_PRESETS);
    const reasoningPromptMode = options.overrideInference
        ? inferReasoningPromptMode(options.overrideInference)
        : resolvedPreset
          ? getPresetReasoningPromptMode(resolvedPreset)
          : 'internal-only';

    const promptsForEstimate = new Set<string>(savedPrompts);
    if (looksLikeCompletionBriefIntent(data.message) || data.force_brief) {
        promptsForEstimate.add('pma/completion-brief');
    }

    const initialSystemPrompt = await buildSystemPrompt(
        ctx,
        promptsForEstimate,
        localPath,
        buildServerToolsGuidance(reasoningPromptMode),
    );
    const { allTools, toolGroups } = getChatToolsAndGroups();
    const estimatedTokens = estimateInferenceInputTokens({
        instructions: initialSystemPrompt,
        context: estimationContextMessages,
        tools: allTools,
        toolGroups,
        preprocessContext,
    });

    const isPlainNudge = data.message === null && !data.force_brief;
    const gate = evaluateContextGate({
        estimatedTokens,
        metadataOverflow: chat.metadata?.contextOverflow as ContextOverflowState | undefined,
        forceBrief: data.force_brief,
        bypassContextWarning: data.bypass_context_warning || isPlainNudge,
    });
    if (gate) {
        return new PublicError(ErrorStatus.BadRequest, buildContextGateError(gate));
    }

    return {
        allTools,
        toolGroups,
        initialSystemPrompt,
        localPath,
        estimatedTokens,
        reasoningPromptMode,
        // Image sends need a reload after image files are linked to the persisted user message
        // so loadChatHistory can attach signed image URLs.
        ...(data.imageFileIds?.length ? {} : { contextMessages: estimationContextMessages }),
    };
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
): Promise<ChatActionResult | ReadableStream | Response | PublicError> {
    const { chatId, message, tempId, imageFileIds } = data;
    const { em } = ctx;
    const requestStartedAt = new Date();

    // Pre-generate IDs (Decision #36)
    const userMessageId = crypto.randomUUID();
    const agentMessageId = crypto.randomUUID();

    // Validate ownership. Populate `project` so downstream analytics events can
    // include `project_name` without an extra round trip.
    const chat = await em!.findOneOrFail(
        ChatEntity,
        {
            id: chatId,
            project: { user: { clerkId: ctx.user.userId } },
        },
        { populate: ['project'] },
    );

    const isNudge = message === null;

    // Force-brief routing — schema enforces `message === null` when `force_brief === true`.
    if (data.force_brief === true) {
        return handleForceBrief({
            data,
            ctx,
            options,
            chat,
            deps: { dispatchBlurb: chatActionHandler, prepareChatGenerationInput, runGeneration },
        });
    }

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

    const preparedInput = await prepareChatGenerationInput({ data, ctx, chat, options });
    if (preparedInput instanceof PublicError) return preparedInput;

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
        // while runGeneration pushes content to ChatStreamDO (not to this SSE stream).
        const heartbeat = setInterval(() => enqueue(':keepalive'), 10_000);

        // Run generation inline — Worker stays alive because the DO reads this stream
        try {
            await runGeneration({
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

export interface GenerationParams {
    data: SendChatActionDto;
    ctx: Ctx;
    options: ChatHandlerOptions;
    chat: ChatEntity;
    agentMessageId: string;
    requestStartedAt: Date;
    ugStub: UserGatewayStub;
    preparedInput: PreparedChatGenerationInput;
    safetyPromise: Promise<Awaited<ReturnType<typeof safetyCheck>> | null>;
}

export async function runGeneration(params: GenerationParams): Promise<void> {
    const { data, ctx, options, chat, agentMessageId, ugStub, preparedInput, safetyPromise } = params;
    const { chatId, message } = data;
    const { anthropic, langfuse, em } = ctx;

    const { streamDO, abortController, pusher } = setupStreamInfra(agentMessageId, ctx, 'chat-handler');

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

        // Load previously loaded prompts from chat metadata
        const savedPrompts = (chat.metadata?.loadedPrompts as string[] | undefined) ?? [];

        // Track version IDs created during this turn
        const createdVersionIds: string[] = [];

        // Create combined agent context
        const agentCtx: PromptToolsContext & DocumentToolsContext & KnowledgeSearchContext & UserDecisionContext = {
            loadedPrompts: new Set<string>(savedPrompts),
            em: em!,
            projectId: chat.project!.id,
            chatId: chat.id,
            draftManager: new DraftManager(),
            embeddingQueue: ctx.env.EMBEDDING_QUEUE,
            previewAlias: ctx.previewAlias,
            createdVersionIds,
            // UserDecisionContext — the request_user_decision tool emits the prompt event
            // through this same pusher and long-polls the DO for the user's click.
            pusher,
            streamDO,
            // The PECP generator (called from finalize_document for internal docs) pushes
            // summary_* events through the same SSE pusher the main agent uses.
            pushStreamEvents: pusher.push,
            onVersionCreated: (event) => {
                ugStub
                    .broadcastToAll({ type: 'user_event', eventType: 'artifact_version_created', payload: event })
                    .catch(console.error);

                // Broadcast CB status change via chat-scoped UG topic
                if (event.documentType === 'Completion Brief') {
                    ugStub
                        .systemAction(
                            `chat:${chatId}`,
                            'cbStatusChanged',
                            { status: 'proposed' },
                            ctx.previewAlias ?? undefined,
                        )
                        .catch(console.error);
                }
            },
        };

        const {
            allTools,
            initialSystemPrompt,
            localPath,
            toolGroups,
            reasoningPromptMode: preparedReasoningPromptMode,
        } = preparedInput;

        // Refresh OpenRouter pricing cache if stale (non-blocking background fetch)
        if (ctx.orouterSdk) ensurePricingCache(ctx.orouterSdk);

        // Determine inference params via preset resolution
        const presetId = data.model ?? getDefaultPresetId(ctx.env);
        const resolvedPreset = resolveModelPreset(presetId, ctx.env.ALLOWED_PRESETS, ctx.env.BLOCKED_PRESETS);
        if (!resolvedPreset) {
            throw new Error(`Preset '${presetId}' is not available`);
        }
        const defaultInference = withCommonParams(resolvedPreset.inference, { searchEnabled: true });
        const selectedReasoningPromptMode = options.overrideInference
            ? inferReasoningPromptMode(options.overrideInference)
            : getPresetReasoningPromptMode(resolvedPreset);

        const { inferenceParams, effectivePresetOverride } = pickInferenceParams({
            defaultInference,
            estimatedTokens: preparedInput.estimatedTokens,
            bypassContextWarning: data.bypass_context_warning,
            forceBrief: data.force_brief,
            message,
            overrideInference: options.overrideInference,
        });

        const effectiveReasoningPromptMode: ReasoningPromptMode =
            effectivePresetOverride === 'sonnet-4.6'
                ? 'native'
                : (preparedReasoningPromptMode ?? selectedReasoningPromptMode);
        const systemPromptForRun =
            effectiveReasoningPromptMode === preparedReasoningPromptMode
                ? initialSystemPrompt
                : await buildSystemPrompt(
                      ctx,
                      new Set<string>(savedPrompts),
                      localPath,
                      buildServerToolsGuidance(effectiveReasoningPromptMode),
                  );

        // Run the agent with streaming
        const { stream, historyPromise } = runAgentStream(
            agentCtx,
            ctx,
            {
                ...inferenceParams,
                instructions: systemPromptForRun,
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
                        buildSystemPrompt(
                            ctx,
                            agentCtx.loadedPrompts,
                            localPath,
                            buildServerToolsGuidance(effectiveReasoningPromptMode),
                        ),
                    behavioralGuidance: [
                        'DECISION ESCALATION: Use `request_user_decision` for GENUINE ambiguity only — multiple valid paths where the user must pick (project type at ambiguous initiation, persona disambiguation, framework branching, deliverable type, intent ambiguity, tool errors with multiple named recovery paths). Do NOT silently pick yourself, and do NOT ask in plain text when concrete options exist. FORBIDDEN: (1) refusal-disguise — presenting alternatives when the user already gave an unambiguous command (that is Authority Inversion in tool-call form; if execution is blocked, say so plainly); (2) false ambiguity — asking about details a competent SME can reasonably default. Pre-flight test: "Could a competent SME proceed without clarification?" If yes, proceed. After the user clicks, act on the choice immediately without re-confirming.',
                    ],
                    statusUpdates: { enabled: true },
                    preprocessContext,
                    abortSignal: abortController.signal,
                    onTurnComplete: createOnTurnComplete(agentCtx),
                },
            },
        );

        let pendingDoneEvent: { outputType: 'text' | 'tool'; outputTool?: string; finalOutput?: unknown } | null = null;

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
            docEventsCtx: { em: em!, projectId: agentCtx.projectId, draftManager: agentCtx.draftManager },
            onAgentEvent: (event) => {
                if (event.type === 'delta') {
                    safetyMonitor.appendContent(event.content);
                }
                if (event.type === 'tool_call_complete' && options.onEvent) {
                    options.onEvent({ type: 'tool_call_complete', tool: event.tool, id: event.id, input: event.input });
                }
            },
            onSpecificEvent: async (event) => {
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
                        const errorMetadata = isError
                            ? buildStoredErrorMetadata({
                                  classification: event.error!.classification,
                                  requestId: ctx.requestId,
                              })
                            : null;
                        if (isError) {
                            logWorkerError(
                                'chat-handler',
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
                        const msgMetadata = {
                            preset: presetId,
                            ...(effectivePresetOverride && { effectivePreset: effectivePresetOverride }),
                            inference: extractInferenceMetadata(inferenceParams),
                            ...(errorMetadata && { error: errorMetadata }),
                            ...(messageUsage && { usage: messageUsage }),
                        };

                        if (isError || isAborted || assistantContent || streamLog.blocks.length > 0) {
                            const debugData: Record<string, unknown> = {};
                            if (event.inferenceLog) debugData.inferenceLog = event.inferenceLog;
                            if (isError) {
                                debugData.error = serializeException(event.error!.raw);
                                debugData.rawResponse = event.error!.rawResponse ?? null;
                            }

                            // Strip ephemeral toolContentParts (signed URLs) before DB persistence.
                            // toolImageRefs (stable refs) are kept for history reconstruction.
                            const blocksForDb =
                                streamLog.blocks.length > 0
                                    ? streamLog.blocks.map((b) =>
                                          b.type === 'tool_call' && 'toolContentParts' in b
                                              ? (({ toolContentParts, ...rest }) => rest)(b)
                                              : b,
                                      )
                                    : null;

                            assistantMsg = em!.create(ChatMessageEntity, {
                                id: agentMessageId,
                                chat: chatId,
                                role: 'assistant',
                                content: assistantContent,
                                reasoning: streamLog.fullReasoning || null,
                                blocks: blocksForDb,
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
                                    typeof block.toolInput === 'string'
                                        ? block.toolInput
                                        : JSON.stringify(block.toolInput),
                                );
                                if (block.toolOutput) usedContextTokens += estimateTextTokens(block.toolOutput);
                            }
                        }

                        const usedPromptTokens = estimateTextTokens(systemPromptForRun);
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

                        ctx.eCtx?.waitUntil(
                            captureWorkerPostHogEvent(ctx, 'worker_chat_turn_persisted', ctx.user.userId, {
                                project_id: chat.project?.id ?? null,
                                project_name: chat.project?.name ?? null,
                                chat_id: chatId,
                                chat_name: chat.name ?? null,
                                // chat.name is user-set and frequently null; chat_phase / chat_phase_index
                                // are always populated and let the deploy-safety dashboard show e.g.
                                // "Crystal — HIAI LinkedIn Page — Phase 3" when chat_name is missing.
                                chat_phase: chat.phase,
                                chat_phase_index: chat.phase_index,
                                agent_message_id: agentMessageId,
                                outcome: isError ? 'error' : isAborted ? 'aborted' : 'done',
                                model: msgMetadata.inference?.model as string | undefined,
                                provider: msgMetadata.inference?.paramsType as string | undefined,
                                used_tokens: usedTokens,
                                context_tokens: tokenBreakdown.context,
                                prompt_tokens: tokenBreakdown.prompt,
                                tooldef_tokens: tokenBreakdown.toolDef,
                                input_tokens: messageUsage?.inputTokens,
                                output_tokens: messageUsage?.outputTokens,
                                cost: messageUsage?.cost,
                                created_version_count: createdVersionIds.length,
                                assistant_content_length: assistantContent.length,
                                has_pending_done_tool: pendingDoneEvent?.outputType === 'tool',
                            }).catch((error) => console.error('[posthog] failed to capture chat turn:', error)),
                        );

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

                        // `detail` is dev-only and never persisted, so API fetches can't leak it.
                        const devErrorDetail = isDev && isError ? extractRawErrorMessage(event.error!.raw) : undefined;
                        const wsError = errorMetadata
                            ? { ...errorMetadata, ...(devErrorDetail && { detail: devErrorDetail }) }
                            : undefined;
                        const safeMessageMetadata: Record<string, unknown> | undefined = isDev
                            ? {
                                  ...(msgMetadata.preset && { preset: msgMetadata.preset }),
                                  ...(msgMetadata.inference && { inference: msgMetadata.inference }),
                                  ...(msgMetadata.usage && { usage: msgMetadata.usage }),
                                  ...(wsError && { error: wsError }),
                              }
                            : wsError
                              ? { error: wsError }
                              : undefined;

                        const doneEvent: StreamEvent = {
                            type: 'done',
                            tokenUsage: { tokenBreakdown, usedTokens },
                            ...(isDev && chat.total_cost != null && { totalCost: chat.total_cost }),
                            ...(safeMessageMetadata &&
                                Object.keys(safeMessageMetadata).length > 0 && {
                                    messageMetadata: safeMessageMetadata,
                                }),
                            hasPendingChanges,
                            phaseIndex,
                            ...(isError && { error: errorMetadata?.code ?? 'UNKNOWN' }),
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

        await finalizeStream(streamDO, ugStub, `chat:${chatId}`);
    } catch (error: any) {
        const classification = classifyWorkerError(error);
        const errorMetadata = buildStoredErrorMetadata({ classification, requestId: ctx.requestId });
        logWorkerError(
            'chat-handler',
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
            label: 'chat-handler',
        });
        ctx.eCtx?.waitUntil(
            captureWorkerPostHogEvent(ctx, 'worker_chat_turn_failed', ctx.user.userId, {
                project_id: chat.project?.id ?? null,
                project_name: chat.project?.name ?? null,
                chat_id: chatId,
                chat_name: chat.name ?? null,
                chat_phase: chat.phase,
                chat_phase_index: chat.phase_index,
                agent_message_id: agentMessageId,
                outcome: 'error',
                error_message: error?.message ?? 'Unknown error',
            }).catch((captureError) => console.error('[posthog] failed to capture chat failure:', captureError)),
        );
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
