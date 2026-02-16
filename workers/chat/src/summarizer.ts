import { runAgentStream } from '@common/ai/agent';
import { AIParamsType, type ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { serializeException } from '@common/ai/utils';
import { createEmbeddingQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { SummarizeActionDto } from '@/lib/schema/chat';
import { Ctx } from './context';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { approveVersion } from './tools/documents/document-service';
import { getPromptContent, resolveLocalPromptPath } from './utils/prompt-loader';

export interface SummarizerOptions {
    overrideInference?: ParamsWithType;
}

const SUMMARY_PREFIX = `📋 **Summary of the previous conversation**\n\n---\n\n`;

interface DocumentInfo {
    title: string;
    path: string;
    contentPreview?: string;
}

function extractDocuments(messages: ChatMessageEntity[]): DocumentInfo[] {
    const docs: DocumentInfo[] = [];
    for (const msg of messages) {
        if (!msg.blocks) continue;
        for (const block of msg.blocks as any[]) {
            if (block.type === 'tool_call' && block.toolName === 'finalize_document') {
                const input = block.toolInput;
                if (input?.title && input?.path) {
                    docs.push({
                        title: input.title,
                        path: input.path,
                        contentPreview: input.content?.slice(0, 500),
                    });
                }
            }
        }
    }
    return docs;
}

/**
 * Load summarizer prompt: pma/summarizer + pma/completion-brief, concatenated.
 * Uses the same local-file / Langfuse mechanism as the chat handler.
 */
async function getSummarizerPrompt(ctx: Ctx): Promise<string> {
    const localPath = resolveLocalPromptPath();

    const [summarizerPrompt, completionBriefPrompt] = await Promise.all([
        getPromptContent(ctx, 'pma/summarizer', localPath),
        getPromptContent(ctx, 'pma/completion-brief', localPath),
    ]);

    if (!summarizerPrompt) {
        throw new Error('Failed to load summarizer prompt (pma/summarizer)');
    }
    if (!completionBriefPrompt) {
        throw new Error('Failed to load completion brief prompt (pma/completion-brief)');
    }

    return `${summarizerPrompt}\n\n---\n\n${completionBriefPrompt}`;
}

/**
 * Resolve phase number for the Completion Brief.
 * Priority: chat.phase (if numeric) → count of existing completion briefs + 1
 */
async function resolvePhaseNumber(em: NonNullable<Ctx['em']>, projectId: string, chatPhase: string): Promise<number> {
    const parsed = Number.parseInt(chatPhase, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;

    const count = await em.count(ArtifactEntity, {
        project: projectId,
        key: { $like: 'completion-brief-phase-%' },
    });
    return count + 1;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function streamInternal(
    data: SummarizeActionDto,
    ctx: Ctx,
    controller: ReadableStreamDefaultController<Uint8Array>,
    options: SummarizerOptions = {},
) {
    const { chatId } = data;
    const { em, anthropic } = ctx;
    const encoder = new TextEncoder();

    const enqueue = (data: object | string) => {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    };

    try {
        if (!anthropic) {
            throw new Error('Anthropic client required');
        }

        const chat = await em!.findOneOrFail(ChatEntity, {
            id: chatId,
            project: { user: { clerkId: ctx.user.userId } },
        });

        const messages = await em!.find(ChatMessageEntity, { chat: chatId }, { orderBy: { created_at: 'ASC' } });
        if (!messages.length) {
            throw new Error('Cannot summarize empty chat');
        }

        // Resolve phase number for the Completion Brief
        const phaseNumber = await resolvePhaseNumber(em!, chat.project.id, chat.phase);
        const briefName = `completion-brief-phase-${phaseNumber}.md`;
        const today = new Date().toISOString().split('T')[0];

        const documents = extractDocuments(messages);
        const basePrompt = await getSummarizerPrompt(ctx);

        // Append concrete values as context — don't replace {N} in the prompt since
        // the completion-brief structure uses {N} as AI-fill-in placeholders
        let instructions = `${basePrompt}\n\n---\n\n## Phase Context\n\n- **Phase Number:** ${phaseNumber}\n- **Brief Name:** \`${briefName}\`\n- **Date:** ${today}`;

        if (documents.length > 0) {
            instructions += `\n\n## Documents Created During This Conversation\n\n`;
            for (const doc of documents) {
                instructions += `### ${doc.title}\n`;
                instructions += `**Path:** \`${doc.path}\`\n`;
                if (doc.contentPreview) {
                    instructions += `**Preview:**\n\`\`\`\n${doc.contentPreview}\n\`\`\`\n\n`;
                }
            }
        }

        const historyMessages = messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            ...(m.blocks && { blocks: m.blocks }),
        }));

        // Anthropic requires conversation to end with user message for model to respond.
        historyMessages.push({
            role: 'user' as const,
            content:
                'Please provide a comprehensive summary of this conversation and create the Completion Brief internal artifact.',
        });

        const inferenceParams = options.overrideInference ?? {
            paramsType: AIParamsType.Anthropic,
            params: { model: ANTHROPIC_MODELS.SONNET },
        };

        // Create embedding queue adapter
        const embeddingQueue = createEmbeddingQueueAdapter({
            queue: ctx.env.EMBEDDING_QUEUE,
            httpEndpoint: process.env.EMBEDDING_WORKER_URL
                ? `${process.env.EMBEDDING_WORKER_URL}/enqueue`
                : undefined,
            authSecret: process.env.AUTH_SECRET,
        });

        // Create document tools context
        const createdVersionIds: string[] = [];
        const agentCtx: DocumentToolsContext = {
            em: em!,
            projectId: chat.project.id,
            chatId: chat.id,
            draftManager: new DraftManager(),
            embeddingQueue,
            createdVersionIds,
        };

        // Only include the tools needed for creating the Completion Brief
        const documentTools = createDocumentTools();
        const tools = documentTools.filter((t) =>
            ['begin_document', 'write_document', 'finalize_document'].includes(t.name),
        );

        const { stream, historyPromise } = runAgentStream(
            agentCtx,
            ctx,
            {
                ...inferenceParams,
                instructions,
                context: historyMessages,
                countReasoningAsContent: true,
                contentThreshold: 5,
            },
            tools,
            {
                toolGroups: [DocumentToolGroup],
            },
        );

        let summaryContent = '';

        for await (const event of stream) {
            switch (event.type) {
                case 'delta':
                    summaryContent += event.content;
                    enqueue({ type: 'delta', text: event.content });
                    break;
                case 'tool_start':
                    if (event.tool === 'begin_document') {
                        enqueue({ type: 'document_started' });
                    }
                    break;
                case 'tool_result':
                    // Force all summarizer documents to be internal
                    if (event.tool === 'begin_document' && event.success) {
                        const draft = agentCtx.draftManager.getCurrent();
                        if (draft) draft.is_internal = true;
                    }
                    break;
                case 'error':
                    enqueue({ type: 'error', error: String(event.error) });
                    break;
                default:
                    break;
            }
        }

        await historyPromise;

        // Auto-approve completion briefs (no user approval needed)
        for (const versionId of createdVersionIds) {
            await approveVersion(em!, versionId);
        }

        const newChat = em!.create(ChatEntity, {
            project: chat.project.id,
            phase: chat.phase,
            metadata: {
                summarizedFrom: chatId,
                summarizedAt: new Date().toISOString(),
                documents,
            },
        });
        em!.persist(newChat);

        const summaryMessage = em!.create(ChatMessageEntity, {
            chat: newChat,
            role: 'assistant',
            content: SUMMARY_PREFIX + summaryContent,
        });
        em!.persist(summaryMessage);

        await em!.flush();

        enqueue({
            type: 'done',
            newChatId: newChat.id,
        });
        enqueue('[DONE]');
        controller.close();
    } catch (error: any) {
        const serialized = serializeException(error);
        console.error('[summarizer]', serialized);
        enqueue({ type: 'error', error: serialized.message || 'Summarization failed' });
        controller.close();
    }
}

export async function summarizeActionHandler(data: SummarizeActionDto, ctx: Ctx, options: SummarizerOptions = {}) {
    let ready = false;
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const handler = streamInternal(data, ctx, controller, options);
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
