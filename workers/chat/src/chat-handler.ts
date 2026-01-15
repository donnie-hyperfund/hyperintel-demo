import { runAgentStream } from '@common/ai/agent';
import { AIParamsType } from '@common/ai/inference';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { getLangfusePrompt, getLangfusePromptRaw } from '@worker/vendor/langfuse-prompts';
import { AsyncHandlebars, Handlebars } from 'handlebars-jle';
import { serializeException } from '@/common/ai/utils';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { SendChatActionDto } from '@/lib/schema/chat';
import { Ctx } from './context';
import { createPromptTools, PromptManagementToolGroup, PromptToolsContext } from './tools/prompt-management';

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
// HELPERS
// ============================================================================

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
 */
async function buildSystemPrompt(ctx: Ctx, loadedPrompts: Set<string>): Promise<string> {
    // Base system prompt
    const systemPromptRaw = await getLangfusePromptRaw(
        ctx.langfuse!,
        USE_SHORT_PROMPTS ? 'pma_short/system-prompt' : 'pma/system-prompt',
    );
    let systemPrompt = await compileTemplate(systemPromptRaw, {});
    let allPrompts = ['pma/identity-framework', 'pma/core-methodology', ...loadedPrompts];

    if (USE_SHORT_PROMPTS) {
        allPrompts = allPrompts.map((slug) => slug.replace('pma/', 'pma_short/'));
    }

    // Fetch and append each loaded document
    for (const slug of allPrompts) {
        try {
            const content = await getLangfusePromptRaw(ctx.langfuse!, slug);
            if (content) {
                systemPrompt += `\n\n---\n\n# ${slug.toUpperCase()}\n\n${content}`;
            }
        } catch {
            // Skip failed fetches
        }
    }

    return systemPrompt;
}

// ============================================================================
// STREAM HANDLER
// ============================================================================

async function streamInternal(
    data: SendChatActionDto,
    ctx: Ctx,
    controller: ReadableStreamDefaultController<Uint8Array>,
) {
    const { chatId, message } = data;
    const { anthropic, langfuse, em } = ctx;
    const encoder = new TextEncoder();

    const enqueue = (data: object | string) => {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    };

    try {
        const chat = await em!.findOneOrFail(ChatEntity, {
            id: chatId,
            project: { user: { clerkId: ctx.user.userId } },
        });

        if (!anthropic || !langfuse) {
            throw new Error('Anthropic and Langfuse clients are required');
        }

        // Load history from database
        const dbMessages = await em!.find(ChatMessageEntity, { chat: chatId }, { orderBy: { created_at: 'ASC' } });
        const historyMessages = dbMessages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));

        // Add the new user message
        const allMessages = [...historyMessages, { role: 'user' as const, content: message }];

        // Load previously loaded prompts from chat metadata (fallback to empty)
        const savedPrompts = (chat.metadata?.loadedPrompts as string[] | undefined) ?? [];
        const agentCtx: PromptToolsContext = { loadedPrompts: new Set<string>(savedPrompts) };

        // Get initial system prompt
        const initialSystemPrompt = await buildSystemPrompt(ctx, agentCtx.loadedPrompts);

        // Run the agent with streaming
        const { stream, historyPromise } = runAgentStream(
            agentCtx,
            // @ts-expect-error TODO: should allow passing context with only some providers
            ctx,
            {
                paramsType: AIParamsType.Anthropic,
                params: { model: ANTHROPIC_MODELS.OPUS },
                instructions: initialSystemPrompt,
                context: allMessages,
                maxTokens: 4096 * 3,
            },
            pmaPromptTools,
            {
                toolGroups: [PromptManagementToolGroup],
                config: {
                    maxToolCalls: 20,
                    getSystemPrompt: async () => buildSystemPrompt(ctx, agentCtx.loadedPrompts),
                },
            },
        );

        // Stream events to the client
        let wasTool = false;
        for await (const event of stream) {
            if (event.type !== 'delta') {
                console.log('DEBUG ', JSON.stringify(event, undefined, 2));
            }
            switch (event.type) {
                case 'delta':
                    if (wasTool) {
                        enqueue({ type: 'delta', text: '\n\n' });
                        wasTool = false;
                    }
                    enqueue({ type: 'delta', text: event.content });
                    break;

                case 'tool_start':
                    wasTool = true;
                    enqueue({ type: 'tool_start', tool: event.tool, id: event.id });
                    break;

                case 'tool_result':
                    enqueue({
                        type: 'tool_result',
                        id: event.id,
                        success: event.success,
                        result: event.result,
                    });
                    break;

                case 'done_ext': {
                    // Save user message
                    const userMsg = em!.create(ChatMessageEntity, {
                        chat: chatId,
                        role: 'user',
                        content: message,
                    });
                    em!.persist(userMsg);

                    // Save assistant reply (use accumulatedText or finalOutput)
                    const assistantContent = event.streamLog.fullContent ?? '';
                    if (assistantContent) {
                        const assistantMsg = em!.create(ChatMessageEntity, {
                            chat: chatId,
                            role: 'assistant',
                            content: assistantContent,
                        });
                        em!.persist(assistantMsg);
                    }

                    // Update chat metadata with loaded prompts
                    chat.metadata = {
                        ...chat.metadata,
                        loadedPrompts: Array.from(agentCtx.loadedPrompts),
                    };

                    await em!.flush();
                    enqueue('[DONE]');
                    break;
                }

                case 'error':
                    enqueue({ type: 'error', error: String(event.error) });
                    break;

                case 'search_start':
                    wasTool = true;
                    enqueue({ type: 'search_start', query: event.query, blockId: event.blockId });
                    break;

                case 'search_done':
                    enqueue({ type: 'search_done', blockId: event.blockId });
                    break;

                case 'citation':
                    wasTool = true;
                    enqueue({ type: 'citation', url: event.url, citedText: event.citedText, blockId: event.blockId });
                    break;

                case 'reasoning_start':
                    enqueue({ type: 'reasoning_start', blockId: event.blockId });
                    break;

                case 'reasoning_delta':
                    enqueue({ type: 'reasoning_delta', text: event.content, blockId: event.blockId });
                    break;

                case 'reasoning_done':
                    enqueue({ type: 'reasoning_done', blockId: event.blockId });
                    break;

                case 'status_update':
                    enqueue({ type: 'status_update', source: event.source, status: event.status });
                    break;

                default:
                    console.log('Unknown stream event: ', event);
                    break;
            }
        }

        await historyPromise;
        controller.close();
    } catch (error: any) {
        const serialized = serializeException(error);
        console.log('ERROR ', JSON.stringify(serialized, undefined, 2));

        // Save user message and error reply
        try {
            const userMsg = em!.create(ChatMessageEntity, {
                chat: chatId,
                role: 'user',
                content: message,
            });
            em!.persist(userMsg);

            const errorMsg = em!.create(ChatMessageEntity, {
                chat: chatId,
                role: 'assistant',
                content: 'Sorry, there was an error processing your request. Please try again.',
            });
            em!.persist(errorMsg);

            await em!.flush();
        } catch (saveErr) {
            console.log('Failed to save error messages:', saveErr);
        }

        enqueue({ type: 'error', error: serialized });
        controller.close();
    }
}

// ============================================================================
// EXPORT
// ============================================================================

export async function chatActionHandler(data: SendChatActionDto, ctx: Ctx) {
    let ready = false;
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const handler = streamInternal(data, ctx, controller);
            ctx.eCtx?.waitUntil(handler);
            ready = true;
            await handler;
        },
    });
    while (!ready) {
        await sleep(10);
    }
    return stream;
}
