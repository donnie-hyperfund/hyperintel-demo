/**
 * Intake Handler — Company Profile (CPF) & Human Persona (HPF) flows
 *
 * Thin handler that reuses stream-utils for all the heavy lifting.
 * Only defines: system prompt builder and chat lookup.
 * Uses document tools (begin_document → write_document → finalize_document) for artifact creation.
 */

import { runAgentStream } from '@common/ai/agent';
import { AIParamsType, type ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { serializeException } from '@/common/ai/utils';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';

import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { SendIntakeChatActionDto } from '@/lib/schema/chat';
import type { ChatHandlerOptions } from './chat-handler';
import type { Ctx } from './context';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { createKnowledgeTools, KnowledgeSearchToolGroup, type KnowledgeSearchContext } from './tools/knowledge-search';
import { createDocumentEventHandler } from './utils/document-events';
import { DEFAULT_LOCAL_PROMPTS_PATH, getPromptContent, parseLocalPromptEnv } from './utils/prompt-loader';
import { createEnqueue, createSSEStream, handleCommonStreamEvent, handleStreamError, loadChatHistory } from './utils/stream-utils';

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const DOCUMENT_INSTRUCTIONS: Record<'cpf' | 'hpf', { documentType: string; namePattern: string; titlePattern: string }> = {
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
            champion: 'Champion — External strategic stakeholder. Focus on strategic priorities and decision patterns with high density.',
            collaborator: 'Collaborator — External operational contact. Focus on working preferences and communication style with standard density.',
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
// HANDLER
// ============================================================================

export async function intakeActionHandler(data: SendIntakeChatActionDto, ctx: Ctx, options: ChatHandlerOptions = {}) {
    return createSSEStream(async (controller) => {
        const { chatId, message } = data;
        const { anthropic, langfuse, em } = ctx;
        const requestStartedAt = new Date();
        const enqueue = createEnqueue(controller);

        try {
            const chat = await em!.findOneOrFail(ChatEntity, {
                id: chatId,
                type: 'intake',
                user: { clerkId: ctx.user.userId },
            }, { populate: ['user'] });

            if (!anthropic || !langfuse) {
                throw new Error('Anthropic and Langfuse clients are required');
            }

            const framework = chat.metadata?.framework as 'cpf' | 'hpf';
            const category = chat.metadata?.category as string | undefined;
            if (!framework) throw new Error('Chat metadata missing framework type');

            const userId = chat.user!.id;

            // Reuse shared history loader
            const historyMessages = await loadChatHistory(em!, chatId);
            const allMessages = [...historyMessages, { role: 'user' as const, content: message }];

            // Track version IDs created during this turn
            const createdVersionIds: string[] = [];

            const agentCtx: DocumentToolsContext & KnowledgeSearchContext = {
                em: em!,
                userId,
                chatId: chat.id,
                draftManager: new DraftManager(),
                createdVersionIds,
            };

            // Resolve local prompts path
            const localPromptsSetting = options.useLocalPrompts ?? parseLocalPromptEnv();
            const localPath = localPromptsSetting
                ? localPromptsSetting === true ? DEFAULT_LOCAL_PROMPTS_PATH : localPromptsSetting
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
            let pendingDoneEvent: { outputType: 'text' | 'tool'; outputTool?: string } | null = null;

            // Document event handler for frontend streaming
            const docEvents = createDocumentEventHandler({ em: em! }, (docEvent) => enqueue(docEvent));

            for await (const event of stream) {
                docEvents.handle(event);

                if (handleCommonStreamEvent(enqueue, event, state)) continue;

                // Endpoint-specific events
                switch (event.type) {
                    case 'done':
                        pendingDoneEvent = { outputType: event.outputType, outputTool: event.outputTool };
                        break;

                    case 'done_ext': {
                        const isError = !!event.error;
                        const streamLog = event.streamLog;

                        // Persist user message
                        const userMsg = em!.create(ChatMessageEntity, {
                            chat: chatId,
                            role: 'user',
                            content: message,
                            created_at: requestStartedAt,
                        });
                        em!.persist(userMsg);

                        // Persist assistant message
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

                        await em!.flush();

                        enqueue({
                            type: 'done',
                            outputType: pendingDoneEvent?.outputType ?? 'text',
                            outputTool: pendingDoneEvent?.outputTool,
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
