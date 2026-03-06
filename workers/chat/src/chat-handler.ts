import { runAgentStream } from '@common/ai/agent';
import type { AgentStreamEvent } from '@common/ai/agent/types';
import { AIParamsType, ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS, COMMON_MODELS } from '@common/ai/types';
import { createEmbeddingQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { AsyncHandlebars } from 'handlebars-jle';
import { estimateContextTokens, estimateTextTokens, estimateToolTokens, serializeException } from '@/common/ai/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { SendChatActionDto, TokenBreakdown, TokenUsage } from '@/lib/schema/chat';
import type { StreamEvent } from '@/lib/schema/stream';
import type { Ctx } from './context';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { createKnowledgeTools, type KnowledgeSearchContext, KnowledgeSearchToolGroup } from './tools/knowledge-search';
import { createPhaseTransitionTools, PhaseTransitionToolGroup } from './tools/phase-transition';
import { createPromptTools, PromptManagementToolGroup, PromptToolsContext } from './tools/prompt-management';
import { createWebScrapeTools, type WebScrapeContext, WebScrapeToolGroup } from './tools/web-scrape';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import type { ChatStreamDOStub, UserGatewayStub } from './utils/do-stubs';
import { createDocumentEventHandler } from './utils/document-events';
import { DEFAULT_LOCAL_PROMPTS_PATH, getPromptContent, parseLocalPromptEnv } from './utils/prompt-loader';
import { createEventCollector, handleCommonStreamEvent, loadChatHistory, wireAbort } from './utils/stream-utils';

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

    return systemPrompt;
}

// ============================================================================
// CHAT HANDLER — synchronous POST, async generation via waitUntil
// ============================================================================

/**
 * Chat action handler — saves user message, registers stream, returns IDs synchronously.
 * Generation runs in ctx.waitUntil(), pushing events to ChatStream DO.
 */
export async function chatActionHandler(
    data: SendChatActionDto,
    ctx: Ctx,
    options: ChatHandlerOptions = {},
): Promise<ChatActionResult> {
    const { chatId, message, tempId } = data;
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

    // Save user message immediately (Decision #37)
    const userMsg = em!.create(ChatMessageEntity, {
        id: userMessageId,
        chat: chatId,
        role: 'user',
        content: message,
        created_at: requestStartedAt,
    });
    em!.persist(userMsg);

    // Set activeAgentMessageId on chat entity
    chat.active_agent_message_id = agentMessageId;
    await em!.flush();

    // Broadcast message_created to all subscribers
    const alias = ctx.previewAlias;
    const ugId = ctx.env.USER_GATEWAY.idFromName(branchDoName(ctx.user.userId, alias));
    const ugStub = ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;
    const messagePayload: Record<string, unknown> = { message: userMsg.toJSON() };
    if (tempId) {
        messagePayload.tempId = tempId;
    }
    await ugStub.systemAction(`chat:${chatId}`, 'messageCreated', messagePayload, alias ?? undefined);

    // Register stream via UG → ChatTopicHandler → ChatStream DO init
    // Pass userId so the handler can auto-subscribe the initiator to the ChatStream DO
    await ugStub.systemAction(`chat:${chatId}`, 'registerStream', {
        agentMessageId,
        userId: ctx.user.userId,
        userMessageId,
    }, alias ?? undefined);

    // Kick off generation in waitUntil — response returned before generation starts
    const generationPromise = runGeneration({
        data,
        ctx,
        options,
        chat,
        agentMessageId,
        requestStartedAt,
        ugStub,
    });

    if (ctx.eCtx?.waitUntil) {
        ctx.eCtx.waitUntil(generationPromise);
    }

    return {
        userMessageId,
        agentMessageId,
        ...(options.onEvent && { generation: generationPromise }),
    };
}

// ============================================================================
// GENERATION — runs in waitUntil, pushes events to ChatStream DO
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

    try {
        if (!anthropic || !langfuse) {
            throw new Error('Anthropic and Langfuse clients are required');
        }

        // Load history from database
        const allMessages = await loadChatHistory(em!, chatId);
        // const allMessages = [...historyMessages, { role: 'user' as const, content: message }];

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
            createdVersionIds,
            onVersionCreated: (event) => {
                ugStub.broadcastToAll({ type: 'user_event', eventType: 'artifact_version_created', payload: event }).catch(console.error);
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

        // Determine inference params
        const defaultInference: ParamsWithType = {
            paramsType: AIParamsType.Anthropic,
            params: {
                model: data.model ?? ANTHROPIC_MODELS.SONNET,
                thinking: true,
                thinkingBudget: 8000,
                searchEnabled: true,
            },
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
                        return null;
                    },
                },
            },
        );

        // Event collector for DO push (replaces SSE enqueue)
        const collector = createEventCollector();
        const state = { wasTool: false };
        let pendingDoneEvent: { outputType: 'text' | 'tool'; outputTool?: string; finalOutput?: unknown } | null = null;

        // Track in-flight DO pushes so we can drain before terminal events
        let pushSeq = 0;
        const inflightPushes: Promise<void>[] = [];
        const fireAndForgetPush = (events: StreamEvent[]) => {
            const p = streamDO.push(events, pushSeq++).catch((err) => console.error('[chat-handler] push failed:', err));
            inflightPushes.push(p);
        };

        // Document events queue — batched into the main push instead of separate RPCs
        const pendingDocEvents: StreamEvent[] = [];
        const docEvents = createDocumentEventHandler({ em: em!, projectId: agentCtx.projectId }, (docEvent) => {
            const se = docEvent as StreamEvent;
            pendingDocEvents.push(se);
            options.onEvent?.(se);
        });

        // Stream loop — push events to ChatStream DO instead of SSE
        for await (const event of stream) {
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
                            ...(isError && {
                                is_error: true,
                                metadata: { error: event.error!.message },
                            }),
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
                    chat.active_agent_message_id = null;

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
                    const doneEvent: StreamEvent = {
                        type: 'done',
                        tokenUsage: { tokenBreakdown, usedTokens },
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
                    await Promise.allSettled(inflightPushes);
                    await streamDO.push([doneEvent], pushSeq++);
                    options.onEvent?.(doneEvent);
                    break;
                }
                default:
                    // TODO
                    break;
            }
        }

        await historyPromise;

        // done() → persist (above) → finalize() → clearStream (Decision #20)
        try {
            await streamDO.done();
            await streamDO.finalize();
        } finally {
            await ugStub.systemAction(`chat:${chatId}`, 'clearStream', {}).catch(() => {});
        }
    } catch (error: any) {
        console.error('[chat-handler] generation error:', error?.message ?? error, error?.stack);

        // Persist error state
        try {
            const existing = await em!.findOne(ChatMessageEntity, { id: agentMessageId });
            if (!existing) {
                const errorMsg = em!.create(ChatMessageEntity, {
                    id: agentMessageId,
                    chat: chatId,
                    role: 'assistant',
                    content: '',
                    is_error: true,
                    metadata: { error: error?.message || 'Unknown error' },
                    debug_data: { error: serializeException(error) },
                });
                em!.persist(errorMsg);
            }
            chat.active_agent_message_id = null;
            await em!.flush();
        } catch (saveErr) {
            console.error('[chat-handler] failed to save error state:', saveErr);
        }

        // Push error event + mark DO as errored
        try {
            await Promise.allSettled(inflightPushes);
            await streamDO.push([{ type: 'error', error: error?.message || 'Unknown error' }], pushSeq++);
            await streamDO.done();
            await streamDO.finalize();
        } catch {
            /* DO might already be gone */
        } finally {
            await ugStub.systemAction(`chat:${chatId}`, 'clearStream', {}).catch(() => {});
        }
    }
}
