import { runAgentStream } from '@common/ai/agent';
import { AIParamsType, ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS, COMMON_MODELS } from '@common/ai/types';
import { createEmbeddingQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { getLangfusePrompt } from '@worker/vendor/langfuse-prompts';
import { AsyncHandlebars, Handlebars } from 'handlebars-jle';
import { estimateContextTokens, estimateTextTokens, estimateToolTokens, serializeException } from '@/common/ai/utils';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { SendChatActionDto, TokenBreakdown, TokenUsage } from '@/lib/schema/chat';
import { Ctx } from './context';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { createKnowledgeTools, type KnowledgeSearchContext, KnowledgeSearchToolGroup } from './tools/knowledge-search';
import { createPromptTools, PromptManagementToolGroup, PromptToolsContext } from './tools/prompt-management';
import { createWebScrapeTools, type WebScrapeContext, WebScrapeToolGroup } from './tools/web-scrape';
import { createPhaseTransitionTools, PhaseTransitionToolGroup } from './tools/phase-transition';
import { createDocumentEventHandler } from './utils/document-events';
import {
    DEFAULT_LOCAL_PROMPTS_PATH,
    getPromptContent,
    parseLocalPromptEnv,
    slugToLocalFile,
} from './utils/prompt-loader';
import { createEnqueue, createSSEStream, handleCommonStreamEvent, handleStreamError, loadChatHistory } from './utils/stream-utils';

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
// STREAM HANDLER
// ============================================================================

export async function chatActionHandler(data: SendChatActionDto, ctx: Ctx, options: ChatHandlerOptions = {}) {
    return createSSEStream(async (controller) => {
        const { chatId, message } = data;
        const { anthropic, langfuse, em } = ctx;
        const requestStartedAt = new Date();
        const enqueue = createEnqueue(controller);

        try {
            const chat = await em!.findOneOrFail(ChatEntity, {
                id: chatId,
                project: { user: { clerkId: ctx.user.userId } },
            });

            if (!anthropic || !langfuse) {
                throw new Error('Anthropic and Langfuse clients are required');
            }

            // Load history from database (shared helper)
            const historyMessages = await loadChatHistory(em!, chatId);
            const allMessages = [...historyMessages, { role: 'user' as const, content: message }];

            // Load previously loaded prompts from chat metadata (fallback to empty)
            const savedPrompts = (chat.metadata?.loadedPrompts as string[] | undefined) ?? [];

            // Create embedding queue adapter (uses native Queue in workers, HTTP in local)
            const embeddingQueue = createEmbeddingQueueAdapter({
                // Native Cloudflare Queue binding (available in workers)
                queue: ctx.env.EMBEDDING_QUEUE,
                // HTTP fallback for local development
                httpEndpoint: process.env.EMBEDDING_WORKER_URL ? `${process.env.EMBEDDING_WORKER_URL}/enqueue` : undefined,
                authSecret: process.env.AUTH_SECRET,
            });

            // Track version IDs created during this turn - will be linked to assistant message after persist
            const createdVersionIds: string[] = [];

            // Create combined agent context for all tool types
            const agentCtx: PromptToolsContext & DocumentToolsContext & KnowledgeSearchContext = {
                // Prompt tools context
                loadedPrompts: new Set<string>(savedPrompts),
                // Document tools context
                em: em!,
                projectId: chat.project.id,
                chatId: chat.id,
                draftManager: new DraftManager(),
                // Embedding queue adapter for async indexing
                embeddingQueue,
                createdVersionIds,
            };

            // Resolve local prompts path from options, falling back to env var
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

            // Determine inference params - use override if provided, otherwise default
            const defaultInference: ParamsWithType = {
                paramsType: AIParamsType.Anthropic,
                params: { model: data.model ?? ANTHROPIC_MODELS.SONNET, thinking: true, thinkingBudget: 8000, searchEnabled: true },
            };
            const inferenceParams = options.overrideInference ?? defaultInference;

            // Define tools and tool groups (used for agent and token estimation)
            const allTools = [
                ...pmaPromptTools,
                ...createDocumentTools(),
                ...createKnowledgeTools(),
                ...createWebScrapeTools(),
                ...createPhaseTransitionTools(),
            ];
            const toolGroups = [PromptManagementToolGroup, DocumentToolGroup, KnowledgeSearchToolGroup, WebScrapeToolGroup, PhaseTransitionToolGroup];

            // Run the agent with streaming
            const { stream, historyPromise } = runAgentStream(
                agentCtx,
                // @ ts-expect-error TODO: should allow passing context with only some providers available
                ctx,
                {
                    ...inferenceParams,
                    instructions: initialSystemPrompt,
                    context: allMessages,
                    // maxTokens: 4096 * 3,
                    countReasoningAsContent: true,
                    contentThreshold: 5,
                },
                allTools,
                {
                    toolGroups,
                    terminalToolNames: ['generate_summary'],
                    config: {
                        maxToolCalls: 20,
                        getSystemPrompt: async () =>
                            buildSystemPrompt(ctx, agentCtx.loadedPrompts, localPath, WEB_SEARCH_GUIDANCE),
                        statusUpdates: { enabled: true },
                        preprocessContext,
                        onTurnComplete: () => {
                            if (agentCtx.draftManager.hasActive()) {
                                return 'You have an unfinalized document draft. You MUST call finalize_document now or the content will be lost.';
                            }
                            return null;
                        },
                    },
                },
            );

            // Stream events — common events handled by shared helper
            const state = { wasTool: false };
            let pendingDoneEvent: { outputType: 'text' | 'tool'; outputTool?: string; finalOutput?: unknown } | null = null;

            // Document event handler for frontend streaming
            const docEvents = createDocumentEventHandler({ em: em!, projectId: agentCtx.projectId }, (docEvent) =>
                enqueue(docEvent),
            );

            for await (const event of stream) {
                // Let document handler process the event
                await docEvents.handle(event);

                // Delegate common events to shared handler
                if (handleCommonStreamEvent(enqueue, event, state)) continue;

                // Chat-specific events
                switch (event.type) {
                    case 'done':
                        // Store done event data - will be combined with done_ext
                        pendingDoneEvent = {
                            outputType: event.outputType,
                            outputTool: event.outputTool,
                            finalOutput: event.finalOutput,
                        };
                        break;

                    case 'done_ext': {
                        const isError = !!event.error;

                        // Save user message with request start time (prevents timestamp collision with assistant)
                        const userMsg = em!.create(ChatMessageEntity, {
                            chat: chatId,
                            role: 'user',
                            content: message,
                            created_at: requestStartedAt,
                        });
                        em!.persist(userMsg);

                        // Save assistant reply with structured data
                        const streamLog = event.streamLog;
                        const assistantContent = streamLog.fullContent ?? '';
                        let assistantMsg: ChatMessageEntity | null = null;
                        if (isError || assistantContent || streamLog.blocks.length > 0) {
                            const debugData: Record<string, unknown> = {};
                            if (event.inferenceLog) debugData.inferenceLog = event.inferenceLog;
                            if (isError) {
                                debugData.error = serializeException(event.error!.raw);
                                debugData.rawResponse = event.error!.rawResponse ?? null;
                            }

                            assistantMsg = em!.create(ChatMessageEntity, {
                                chat: chatId,
                                role: 'assistant',
                                content: assistantContent,
                                reasoning: streamLog.fullReasoning || null,
                                blocks: streamLog.blocks.length > 0 ? streamLog.blocks : null,
                                ...(isError && {
                                    is_error: true,
                                    metadata: { error: event.error!.message },
                                }),
                                ...(Object.keys(debugData).length > 0 && { debug_data: debugData }),
                            });
                            em!.persist(assistantMsg);
                        }

                        // Link created document versions to the assistant message
                        if (assistantMsg && createdVersionIds.length > 0) {
                            await em!
                                .createQueryBuilder(ArtifactVersionEntity)
                                .update({ chat_message: assistantMsg.id })
                                .where({ id: { $in: createdVersionIds } })
                                .execute();
                        }

                        // Calculate token usage estimates
                        // Historical messages + new user message
                        let usedContextTokens = estimateContextTokens(allMessages);

                        // Add this run's assistant response (text + reasoning + tool calls)
                        if (assistantContent) {
                            usedContextTokens += estimateTextTokens(assistantContent);
                        }
                        if (streamLog.fullReasoning) {
                            usedContextTokens += estimateTextTokens(streamLog.fullReasoning);
                        }
                        // Tool call blocks contribute to context
                        for (const block of streamLog.blocks) {
                            if (block.type === 'tool_call') {
                                // Estimate tool name + input + output
                                usedContextTokens += estimateTextTokens(block.toolName);
                                usedContextTokens += estimateTextTokens(
                                    typeof block.toolInput === 'string' ? block.toolInput : JSON.stringify(block.toolInput),
                                );
                                if (block.toolOutput) {
                                    usedContextTokens += estimateTextTokens(block.toolOutput);
                                }
                            }
                        }

                        // Estimate prompt tokens - get the current system prompt
                        const currentSystemPrompt = await buildSystemPrompt(ctx, agentCtx.loadedPrompts, localPath);
                        const usedPromptTokens = estimateTextTokens(currentSystemPrompt);

                        // Estimate tool tokens (guidance in prompt + schemas)
                        const toolTokens = estimateToolTokens(allTools, toolGroups);
                        const usedPromptToolTokens = toolTokens.promptToolTokens;
                        const usedToolDefTokens = toolTokens.toolDefTokens;

                        const usedTokens = usedContextTokens + usedPromptTokens + usedToolDefTokens;
                        const tokenBreakdown: TokenBreakdown = {
                            context: usedContextTokens,
                            prompt: usedPromptTokens,
                            promptTool: usedPromptToolTokens,
                            toolDef: usedToolDefTokens,
                        };

                        // Update chat metadata with loaded prompts
                        chat.metadata = {
                            ...chat.metadata,
                            loadedPrompts: Array.from(agentCtx.loadedPrompts),
                        };

                        chat.token_usage = {
                            tokenBreakdown,
                            usedTokens,
                        };

                        await em!.flush();

                        // Emit combined done event with token estimates
                        enqueue({
                            type: 'done',
                            outputType: pendingDoneEvent?.outputType ?? 'text',
                            outputTool: pendingDoneEvent?.outputTool,
                            tokenBreakdown,
                            usedTokens,
                            ...(isError && { error: event.error!.message }),
                        });
                        enqueue('[DONE]');
                        break;
                    }
                }
            }

            await historyPromise;
            controller.close();
        } catch (error: any) {
            await handleStreamError(error, em!, chatId, message, enqueue, controller, requestStartedAt);
        }
    }, ctx);
}
