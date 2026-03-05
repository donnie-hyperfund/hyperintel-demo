/**
 * Intake Handler — Company Profile (CPF) & Human Persona (HPF) flows
 *
 * Migrated to the broker pattern (Task 13):
 * - Returns { agentMessageId } synchronously
 * - Saves user message + sets active_agent_message_id before waitUntil
 * - Pushes StreamEvent[] to ChatStreamDO via waitUntil
 * - No SSE — events delivered via UserGateway WS subscription to 'intake:{chatId}'
 */

import { runAgentStream } from '@common/ai/agent';
import { AIParamsType, type ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { serializeException } from '@/common/ai/utils';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { SendIntakeChatActionDto } from '@/lib/schema/chat';
import type { StreamEvent } from '@/lib/schema/stream';
import type { ChatHandlerOptions } from './chat-handler';
import type { Ctx } from './context';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { createKnowledgeTools, KnowledgeSearchToolGroup, type KnowledgeSearchContext } from './tools/knowledge-search';
import type { ChatStreamDOStub, UserGatewayStub } from './utils/do-stubs';
import { createDocumentEventHandler } from './utils/document-events';
import { DEFAULT_LOCAL_PROMPTS_PATH, getPromptContent, parseLocalPromptEnv } from './utils/prompt-loader';
import { createEventCollector, handleCommonStreamEvent, loadChatHistory, wireAbort } from './utils/stream-utils';

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
        titlePattern: 'Company Profile: [Company Name]',
    },
    hpf: {
        documentType: 'Human Persona',
        namePattern: 'human-persona-[person-name-slug].md',
        titlePattern: 'Human Persona: [Person Name] ([Category])',
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
   - \`is_internal\`: \`true\`
   - \`document_type\`: \`${docInfo.documentType}\`

2. Call \`write_document\` with the full content.

3. Call \`finalize_document\` to save. You MUST call this or the content will be lost.`;

    return systemPrompt;
}

// ============================================================================
// INTAKE HANDLER — synchronous POST, async generation via waitUntil
// ============================================================================

export interface IntakeActionResult {
    userMessageId: string;
    agentMessageId: string;
    /** Resolves when generation completes. Present when onEvent is provided. */
    generation?: Promise<void>;
}

/**
 * Intake action handler — saves user message, registers stream, returns IDs synchronously.
 * Generation runs in ctx.waitUntil(), pushing events to ChatStream DO.
 */
export async function intakeActionHandler(
    data: SendIntakeChatActionDto,
    ctx: Ctx,
    options: ChatHandlerOptions = {},
): Promise<IntakeActionResult> {
    const { chatId, message } = data;
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

    // Save user message immediately (before waitUntil)
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

    // Get UserGateway stub for this user
    const ugId = ctx.env.USER_GATEWAY.idFromName(ctx.user.userId);
    const ugStub = ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;

    // Broadcast message_created so other tabs can reconcile the user message
    const messagePayload: Record<string, unknown> = { message: userMsg.toJSON() };
    if (data.tempId) {
        messagePayload.tempId = data.tempId;
    }
    await ugStub.systemAction(`intake:${chatId}`, 'messageCreated', messagePayload);

    // Register stream via UG → IntakeTopicHandler → ChatStream DO init
    await ugStub.systemAction(`intake:${chatId}`, 'registerStream', {
        agentMessageId,
        userId: ctx.user.userId,
        userMessageId,
    });

    // Kick off generation in waitUntil — response returned before generation starts
    const generationPromise = runIntakeGeneration({
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
    const { data, ctx, options, chat, agentMessageId, requestStartedAt, ugStub } = params;
    const { chatId, message } = data;
    const { anthropic, langfuse, em } = ctx;

    // Get ChatStream DO stub — already initialized by registerStream above
    const streamDO = ctx.env.CHAT_STREAM_DO.get(
        ctx.env.CHAT_STREAM_DO.idFromName(agentMessageId),
    ) as unknown as ChatStreamDOStub;

    // Wire abort: ChatStreamDO abort → AbortController → runner's abortSignal
    const abortController = wireAbort(streamDO);

    try {
        if (!anthropic || !langfuse) {
            throw new Error('Anthropic and Langfuse clients are required');
        }

        const framework = chat.metadata?.framework as 'cpf' | 'hpf';
        const category = chat.metadata?.category as string | undefined;
        if (!framework) throw new Error('Chat metadata missing framework type');

        // Load history from database
        const historyMessages = await loadChatHistory(em!, chatId);
        const allMessages = [...historyMessages, { role: 'user' as const, content: message }];

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

        const systemPrompt = await buildIntakeSystemPrompt(ctx, framework, category, localPath);

        const defaultInference: ParamsWithType = {
            paramsType: AIParamsType.Anthropic,
            params: { model: data.model ?? ANTHROPIC_MODELS.SONNET, thinking: false },
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
                    onTurnComplete: () => {
                        if (agentCtx.draftManager.hasActive()) {
                            return 'You have an unfinalized document draft. You MUST call finalize_document now or the content will be lost.';
                        }
                        return null;
                    },
                },
            },
        );

        // Event collector for DO push
        const collector = createEventCollector();
        const state = { wasTool: false };
        let pendingDoneEvent: { outputType: 'text' | 'tool'; outputTool?: string } | null = null;

        // Document event handler — pushes document events directly to DO
        const docEvents = createDocumentEventHandler({ em: em! }, (docEvent) => {
            const se = docEvent as StreamEvent;
            streamDO.push([se]).catch((err) => console.error('[intake-handler] doc event push failed:', err));
            options.onEvent?.(se);
        });

        // Stream loop — push events to ChatStream DO instead of SSE
        for await (const event of stream) {
            await docEvents.handle(event);

            if (handleCommonStreamEvent(collector.enqueue, event, state)) {
                const events = collector.drain();
                if (events.length > 0) {
                    await streamDO.push(events);
                    if (options.onEvent) events.forEach((e) => options.onEvent!(e));
                }
                continue;
            }

            // Intake-specific events
            switch (event.type) {
                case 'done':
                    pendingDoneEvent = { outputType: event.outputType, outputTool: event.outputTool };
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
                        ...(pendingDoneEvent?.outputType === 'tool' &&
                            pendingDoneEvent.outputTool && {
                                outputType: 'tool' as const,
                                outputTool: pendingDoneEvent.outputTool,
                            }),
                    };
                    await streamDO.push([doneEvent]);
                    options.onEvent?.(doneEvent);
                    break;
                }

                default:
                    break;
            }
        }

        await historyPromise;

        // done() → persist (above) → finalize() → clearStream (Decision #20)
        try {
            await streamDO.done();
            await streamDO.finalize();
        } finally {
            await ugStub.systemAction(`intake:${chatId}`, 'clearStream', {}).catch(() => {});
        }
    } catch (error: any) {
        console.error('[intake-handler] generation error:', error?.message ?? error, error?.stack);

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
            console.error('[intake-handler] failed to save error state:', saveErr);
        }

        // Push error event + mark DO as errored
        try {
            await streamDO.push([{ type: 'error', error: error?.message || 'Unknown error' }]);
            await streamDO.done();
            await streamDO.finalize();
        } catch {
            /* DO might already be gone */
        } finally {
            await ugStub.systemAction(`intake:${chatId}`, 'clearStream', {}).catch(() => {});
        }
    }
}
