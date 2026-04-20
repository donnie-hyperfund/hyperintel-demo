import { runAgentStream } from '@common/ai/agent';
import { buildMessageUsage } from '@common/ai/agent/usage-builder';
import { extractInferenceMetadata, type ParamsWithType } from '@common/ai/inference';
import { ensurePricingCache } from '@common/ai/inference/openrouter-pricing';
import { AsyncHandlebars } from 'handlebars-jle';
import { estimateContextTokens, estimateTextTokens, estimateToolTokens, serializeException } from '@/common/ai/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { getAvailablePresets, getDefaultPresetId, resolvePreset } from '@/lib/presets';
import type { SendChatActionDto, TokenBreakdown } from '@/lib/schema/chat';
import type { StreamEvent } from '@/lib/schema/stream';
import { branchDoName } from '@/workers/_common/util/preview-alias';
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
import { createWebScrapeTools, WebScrapeToolGroup } from './tools/web-scrape';
import { resolvePricing } from './utils/cost';
import type { UserGatewayStub } from './utils/do-stubs';
import { captureWorkerPostHogEvent } from './utils/posthog';
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
    const { data, ctx, options, chat, agentMessageId, ugStub } = params;
    const { chatId, message } = data;
    const { anthropic, langfuse, em } = ctx;

    const { streamDO, abortController, pusher } = setupStreamInfra(agentMessageId, ctx, 'chat-handler');

    try {
        if (!anthropic || (!langfuse && !options.useLocalPrompts)) {
            throw new Error(
                'Anthropic and Langfuse clients are required (langfuse can be skipped with useLocalPrompts)',
            );
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

        // Track version IDs created during this turn
        const createdVersionIds: string[] = [];

        // Create combined agent context
        const agentCtx: PromptToolsContext & DocumentToolsContext & KnowledgeSearchContext = {
            loadedPrompts: new Set<string>(savedPrompts),
            em: em!,
            projectId: chat.project!.id,
            chatId: chat.id,
            draftManager: new DraftManager(),
            embeddingQueue: ctx.env.EMBEDDING_QUEUE,
            previewAlias: ctx.previewAlias,
            createdVersionIds,
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
            WEB_SEARCH_GUIDANCE + '\n\n' + COMPLETION_BRIEF_GUIDANCE,
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
            ...createCompletionBriefTools(),
            ...createDocumentTools(),
            ...createKnowledgeTools(),
            ...createWebScrapeTools(),
            ...createPhaseTransitionTools(),
        ];
        const toolGroups = [
            PromptManagementToolGroup,
            CompletionBriefToolGroup,
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
                        buildSystemPrompt(
                            ctx,
                            agentCtx.loadedPrompts,
                            localPath,
                            WEB_SEARCH_GUIDANCE + '\n\n' + COMPLETION_BRIEF_GUIDANCE,
                        ),
                    statusUpdates: { enabled: true },
                    preprocessContext,
                    abortSignal: abortController.signal,
                    onTurnComplete: createOnTurnComplete(agentCtx, { pecp: true }),
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

                        ctx.eCtx?.waitUntil(
                            captureWorkerPostHogEvent(ctx, 'worker_chat_turn_persisted', ctx.user.userId, {
                                project_id: chat.project?.id ?? null,
                                chat_id: chatId,
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

                        // Build safe message metadata for WS delivery (no error, safetyAnalysis, etc.)
                        // Only include dev-only fields (preset, inference, usage) in dev mode
                        const safeMessageMetadata: Record<string, unknown> | undefined = isDev
                            ? {
                                  ...(msgMetadata.preset && { preset: msgMetadata.preset }),
                                  ...(msgMetadata.inference && { inference: msgMetadata.inference }),
                                  ...(msgMetadata.usage && { usage: msgMetadata.usage }),
                              }
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
                        break;
                }
            },
            onEvent: options.onEvent,
        });

        await historyPromise;

        await finalizeSafetyMonitor(safetyMonitor, em!, agentMessageId);

        await finalizeStream(streamDO, ugStub, `chat:${chatId}`);
    } catch (error: any) {
        console.error('[chat-handler] generation error:', error?.message ?? error, error?.stack);
        await persistErrorMessage(em!, chatId, agentMessageId, chat, error, 'chat-handler');
        ctx.eCtx?.waitUntil(
            captureWorkerPostHogEvent(ctx, 'worker_chat_turn_failed', ctx.user.userId, {
                project_id: chat.project?.id ?? null,
                chat_id: chatId,
                agent_message_id: agentMessageId,
                outcome: 'error',
                error_message: error?.message ?? 'Unknown error',
            }).catch((captureError) => console.error('[posthog] failed to capture chat failure:', captureError)),
        );
        await cleanupStreamDO(pusher, streamDO, ugStub, `chat:${chatId}`, error);
    }
}
