import { runAgentStream } from '@common/ai/agent';
import { AIParamsType, type ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { serializeException, stringifyError } from '@common/ai/utils';
import { createEmbeddingQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { SummarizeActionDto } from '@/lib/schema/chat';
import { preprocessContext } from './chat-handler';
import { Ctx } from './context';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { approveVersion, listDocuments } from './tools/documents/document-service';
import { getPromptContent, resolveLocalPromptPath } from './utils/prompt-loader';

export interface SummarizerOptions {
    overrideInference?: ParamsWithType;
}

const SUMMARY_PREFIX = `📋 **Summary of the previous conversation**\n\n---\n\n`;

interface DocumentInfo {
    name: string;
    contentPreview?: string;
}

function extractDocuments(messages: ChatMessageEntity[]): DocumentInfo[] {
    const docs: DocumentInfo[] = [];
    for (const msg of messages) {
        if (!msg.blocks) continue;
        for (const block of msg.blocks as any[]) {
            if (block.type === 'tool_call' && block.toolName === 'begin_document') {
                const input = block.toolInput;
                if (input?.name) {
                    docs.push({
                        name: input.name,
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

        // Phase number is 1-based from the 0-based phase_index
        const phaseNumber = chat.phase_index + 1;
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
                instructions += `### ${doc.name}\n`;
                if (doc.contentPreview) {
                    instructions += `**Preview:**\n\`\`\`\n${doc.contentPreview}\n\`\`\`\n\n`;
                }
            }
        }

        // Fetch live document statuses for documents touched in this phase
        const phaseDocNames = new Set(documents.map((d) => d.name));
        if (phaseDocNames.size > 0) {
            const allDocuments = await listDocuments(em!, { projectId: chat.project.id });
            const phaseDocuments = allDocuments.filter((d) => phaseDocNames.has(d.name));
            if (phaseDocuments.length > 0) {
                instructions += `\n\n## Current Document Statuses (this phase)\n\n`;
                for (const doc of phaseDocuments) {
                    const status = doc.hasProposed ? 'proposed' : (doc.currentStatus ?? doc.latestStatus);
                    instructions += `- \`${doc.name}\` (${doc.title}): v${doc.latestVersion} — **${status}**\n`;
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
            httpEndpoint: process.env.EMBEDDING_WORKER_URL ? `${process.env.EMBEDDING_WORKER_URL}/enqueue` : undefined,
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
                config: { preprocessContext },
            },
        );

        let summaryContent = '';

        for await (const event of stream) {
            switch (event.type) {
                case 'delta':
                    enqueue({ type: 'delta', text: event.content });
                    break;
                case 'tool_start':
                    if (event.tool === 'begin_document') {
                        enqueue({ type: 'document_started' });
                    }
                    break;
                case 'tool_result':
                    // Force all summarizer documents to be internal Completion Briefs
                    if (event.tool === 'begin_document' && event.success) {
                        const draft = agentCtx.draftManager.getCurrent();
                        if (draft) {
                            draft.is_internal = true;
                            draft.document_type = 'Completion Brief';
                        }
                    }
                    break;
                case 'done_ext':
                    summaryContent = event.streamLog.fullContent ?? '';
                    break;
                case 'error':
                    enqueue({ type: 'error', error: stringifyError(event.error) });
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

        // TODO: Can't use chat.phase_index + 1 because historical chats can trigger summarization too.
        // Once we block message sending on non-latest chats, switch to phase_index-based calculation.
        const newChat = em!.create(ChatEntity, {
            project: chat.project.id,
            phase: chat.phase,
            phase_index: await em!.count(ChatEntity, { project: chat.project.id }),
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

        // Link created document versions to the summary message (must be after flush so summaryMessage has an id)
        if (createdVersionIds.length > 0) {
            await em!
                .createQueryBuilder(ArtifactVersionEntity)
                .update({ chat: newChat.id, chat_message: summaryMessage.id })
                .where({ id: { $in: createdVersionIds } })
                .execute();
        }

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
