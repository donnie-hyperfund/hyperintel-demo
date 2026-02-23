/**
 * Intake Handler — Company Profile (CPF) & Human Persona (HPF) flows
 *
 * Thin handler that reuses stream-utils for all the heavy lifting.
 * Only defines: intake-specific tool, system prompt builder, and chat lookup.
 * Includes document tools for generating artifacts (user-scoped).
 */

import { runAgentStream } from '@common/ai/agent';
import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import { AIParamsType, type ParamsWithType } from '@common/ai/inference';
import { COMMON_MODELS } from '@common/ai/types';
import { serializeException } from '@/common/ai/utils';
import type { EntityManager } from '@mikro-orm/core';
import { z } from 'zod';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { SendIntakeChatActionDto } from '@/lib/schema/chat';
import type { ChatHandlerOptions } from './chat-handler';
import type { Ctx } from './context';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { createDocumentEventHandler } from './utils/document-events';
import { DEFAULT_LOCAL_PROMPTS_PATH, getPromptContent, parseLocalPromptEnv } from './utils/prompt-loader';
import { createEnqueue, createSSEStream, handleCommonStreamEvent, handleStreamError, loadChatHistory } from './utils/stream-utils';

// ============================================================================
// INTAKE TOOL — save_intake_result
// ============================================================================

interface IntakeToolsContext extends DocumentToolsContext {
    chat: ChatEntity;
}

const IntakeToolGroup: AgentToolGroup = {
    name: 'Intake Tools',
    slug: 'intake_',
    description: 'Tools for saving intake session results.',
    tools: ['save_intake_result'],
};

const SaveIntakeResultParams = z.object({
    title: z.string().min(1).describe('Title for the generated profile/persona.'),
    content: z.string().min(1).describe('The full markdown content of the generated Company Profile or Human Persona.'),
});

function createIntakeTools() {
    return [
        {
            name: 'save_intake_result' as const,
            description: `Save the generated Company Profile or Human Persona as the final result of this intake session.

Call this ONLY when you have gathered all necessary information and are ready to produce the final document.
The content should be comprehensive, well-structured markdown.`,
            parameters: SaveIntakeResultParams,
            executor: async (input: z.infer<typeof SaveIntakeResultParams>, ctx: IntakeToolsContext) => {
                const { chat, em } = ctx;
                chat.metadata = {
                    ...chat.metadata,
                    result: {
                        title: input.title,
                        content: input.content,
                        completedAt: new Date().toISOString(),
                    },
                };
                await em.flush();
                return {
                    status: 'saved',
                    title: input.title,
                    message: `Successfully saved "${input.title}". The intake session is now complete.`,
                };
            },
        },
    ] as const;
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

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

    if (framework === 'hpf' && category) {
        const categoryDescriptions: Record<string, string> = {
            principal: 'Principal — HIAI internal leadership. Requires complete organizational map with high density.',
            champion: 'Champion — External strategic stakeholder. Focus on strategic priorities and decision patterns with high density.',
            collaborator: 'Collaborator — External operational contact. Focus on working preferences and communication style with standard density.',
        };
        return `${promptContent}\n\n---\n\n## PERSONA CATEGORY\n\nThe user has selected: **${categoryDescriptions[category] || category}**\n\nAdapt your discovery depth and questions accordingly.`;
    }

    return promptContent;
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

            const agentCtx: IntakeToolsContext = {
                chat,
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
                paramsType: AIParamsType.OpenRouter,
                params: { model: COMMON_MODELS.QWEN_3_5 },
            };
            const inferenceParams = options.overrideInference ?? defaultInference;

            const allTools = [...createIntakeTools(), ...createDocumentTools()];
            const toolGroups = [IntakeToolGroup, DocumentToolGroup];

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
                        maxToolCalls: 10,
                        statusUpdates: { enabled: true },
                    },
                },
            );

            // Stream events — common events handled by shared helper
            const state = { wasTool: false };
            let pendingDoneEvent: { outputType: 'text' | 'tool'; outputTool?: string } | null = null;

            // Document event handler for frontend streaming
            const docEvents = createDocumentEventHandler({ em: em! }, (docEvent) => enqueue(docEvent));

            for await (const event of stream) {
                await docEvents.handle(event);

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
