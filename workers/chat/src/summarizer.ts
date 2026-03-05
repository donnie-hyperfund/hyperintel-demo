import { runAgentStream } from '@common/ai/agent';
import { AIParamsType, type ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { serializeException } from '@common/ai/utils';
import { createEmbeddingQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { SummarizeActionDto } from '@/lib/schema/chat';
import type { StreamEvent } from '@/lib/schema/stream';
import { preprocessContext } from './chat-handler';
import { Ctx } from './context';
import { createDocumentTools, DocumentToolGroup, type DocumentToolsContext, DraftManager } from './tools/documents';
import { approveVersion, listDocuments } from './tools/documents/document-service';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import type { ChatStreamDOStub, UserGatewayStub } from './utils/do-stubs';
import { createDocumentEventHandler } from './utils/document-events';
import { getPromptContent, resolveLocalPromptPath } from './utils/prompt-loader';
import { createEventCollector, handleCommonStreamEvent, wireAbort } from './utils/stream-utils';

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

// ============================================================================
// SUMMARIZE ACTION HANDLER  synchronous POST, async generation via waitUntil
// ============================================================================

export interface SummarizeActionResult {
    agentMessageId: string;
}

/**
 * Summarize action handler  registers stream under chat:{chatId} topic,
 * returns agentMessageId synchronously. Generation runs in ctx.waitUntil(),
 * pushing standard StreamEvent[] to ChatStreamDO via the existing chat topic.
 */
export async function summarizeActionHandler(
    data: SummarizeActionDto,
    ctx: Ctx,
    options: SummarizerOptions = {},
): Promise<SummarizeActionResult> {
    const { chatId } = data;
    const { em } = ctx;

    const agentMessageId = crypto.randomUUID();

    // Validate ownership + load chat entity
    const chat = await em!.findOneOrFail(ChatEntity, {
        id: chatId,
        project: { user: { clerkId: ctx.user.userId } },
    });

    // Set active_agent_message_id on the source chat (same column as normal chat responses)
    chat.active_agent_message_id = agentMessageId;
    await em!.flush();

    // Register stream under chat:{chatId} topic with streamType: 'summary'
    const alias = ctx.previewAlias;
    const ugId = ctx.env.USER_GATEWAY.idFromName(branchDoName(ctx.user.userId, alias));
    const ugStub = ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;
    await ugStub.systemAction(`chat:${chatId}`, 'registerStream', {
        agentMessageId,
        userId: ctx.user.userId,
        streamType: 'summary',
        // summarizer does not have an initiating user message
    }, alias ?? undefined);

    // Kick off generation in waitUntil  response returned before generation starts
    const generationPromise = runSummarizer({
        data,
        ctx,
        options,
        chat,
        agentMessageId,
        ugStub,
    });

    if (ctx.eCtx?.waitUntil) {
        ctx.eCtx.waitUntil(generationPromise);
    }

    return { agentMessageId };
}

// ============================================================================
// GENERATION  runs in waitUntil, pushes events to ChatStream DO
// ============================================================================

interface SummarizerParams {
    data: SummarizeActionDto;
    ctx: Ctx;
    options: SummarizerOptions;
    chat: ChatEntity;
    agentMessageId: string;
    ugStub: UserGatewayStub;
}

async function runSummarizer(params: SummarizerParams): Promise<void> {
    const { data, ctx, options, chat, agentMessageId, ugStub } = params;
    const { chatId } = data;
    const { em, anthropic } = ctx;

    // Get ChatStream DO stub  already initialized by registerStream above
    const alias = ctx.previewAlias;
    const streamDO = ctx.env.CHAT_STREAM_DO.get(
        ctx.env.CHAT_STREAM_DO.idFromName(branchDoName(agentMessageId, alias)),
    ) as unknown as ChatStreamDOStub;

    // Wire abort: ChatStreamDO abort → AbortController → runner's abortSignal
    const abortController = wireAbort(streamDO);

    try {
        if (!anthropic) {
            throw new Error('Anthropic client required');
        }

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

        // Append concrete values as context  don't replace {N} in the prompt since
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
            const allDocuments = await listDocuments(em!, { projectId: chat.project!.id });
            const phaseDocuments = allDocuments.filter((d) => phaseDocNames.has(d.name));
            if (phaseDocuments.length > 0) {
                instructions += `\n\n## Current Document Statuses (this phase)\n\nThese statuses are queried from the database at the time of summarization. Users may approve or reject documents via the UI  this does NOT appear in the conversation history. Use these statuses as the source of truth.\n\n`;
                for (const doc of phaseDocuments) {
                    const status = doc.hasProposed ? 'proposed' : (doc.currentStatus ?? doc.latestStatus);
                    instructions += `- \`${doc.name}\` (${doc.title}): v${doc.latestVersion}  **${status}**\n`;
                }
            }
        }

        instructions += `\n\n## Completion Brief\n\nThe Completion Brief you create is automatically approved by the system immediately after you finish. Report its status as "approved", NOT "proposed". Do not mention that it needs or awaits user approval.\n`;

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
            projectId: chat.project!.id,
            chatId: chat.id,
            draftManager: new DraftManager(),
            embeddingQueue,
            createdVersionIds,
            onVersionCreated: (event) => {
                ugStub
                    .broadcastToAll({ type: 'user_event', eventType: 'artifact_version_created', payload: event })
                    .catch(console.error);
            },
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
                config: { preprocessContext, abortSignal: abortController.signal },
            },
        );

        // Event collector for DO push (replaces hand-rolled SSE enqueue)
        const collector = createEventCollector();
        const state = { wasTool: false };
        let summaryContent = '';

        // Document event handler  pushes document events to DO
        const docEvents = createDocumentEventHandler({ em: em!, projectId: agentCtx.projectId }, (docEvent) => {
            const se = docEvent as StreamEvent;
            streamDO.push([se]).catch((err) => console.error('[summarizer] doc event push failed:', err));
        });

        // Stream loop  push standard StreamEvent[] to ChatStream DO
        for await (const event of stream) {
            // Force all summarizer documents to be internal Completion Briefs
            if (event.type === 'tool_result' && (event as any).tool === 'begin_document' && event.success) {
                const draft = agentCtx.draftManager.getCurrent();
                if (draft) {
                    draft.is_internal = true;
                    draft.document_type = 'Completion Brief';
                }
            }

            // Let document handler process the event
            await docEvents.handle(event);

            // Delegate common events to collector
            if (handleCommonStreamEvent(collector.enqueue, event, state)) {
                const events = collector.drain();
                if (events.length > 0) await streamDO.push(events);
                continue;
            }

            // Summarizer-specific events
            if (event.type === 'done_ext') {
                summaryContent = event.streamLog.fullContent ?? '';
                // done_ext is not pushed directly  terminal done event pushed after DB persist below
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
            project: chat.project!.id,
            phase: chat.phase,
            phase_index: await em!.count(ChatEntity, { project: chat.project!.id }),
            metadata: {
                summarizedFrom: chatId,
                summarizedAt: new Date().toISOString(),
                documents: extractDocuments(messages),
            },
        });
        em!.persist(newChat);

        const summaryMessage = em!.create(ChatMessageEntity, {
            chat: newChat,
            role: 'assistant',
            content: SUMMARY_PREFIX + summaryContent,
        });
        em!.persist(summaryMessage);

        // Clear active_agent_message_id before flush (before finalize)
        chat.active_agent_message_id = null;
        await em!.flush();

        // Link created document versions to the summary message (must be after flush so summaryMessage has an id)
        if (createdVersionIds.length > 0) {
            await em!
                .createQueryBuilder(ArtifactVersionEntity)
                .update({ chat: newChat.id, chat_message: summaryMessage.id })
                .where({ id: { $in: createdVersionIds } })
                .execute();
        }

        // Broadcast chat_created to all user WS connections (fire-and-forget)
        ugStub
            .broadcastToAll({
                type: 'user_event',
                eventType: 'chat_created',
                payload: { chatId: newChat.id, projectId: chat.project!.id },
            })
            .catch(console.error);

        // Push terminal done event with newChatId
        // Ordering: push done  streamDO.done()  clear entity  finalize()  clearStream (Decision #20)
        await streamDO.push([{ type: 'done', newChatId: newChat.id }]);

        try {
            await streamDO.done();
            await streamDO.finalize();
        } finally {
            await ugStub.systemAction(`chat:${chatId}`, 'clearStream', {}).catch(() => {});
        }
    } catch (error: any) {
        console.error('[summarizer] generation error:', error?.message ?? error, error?.stack);

        // Clear active_agent_message_id on error
        try {
            chat.active_agent_message_id = null;
            await em!.flush();
        } catch (saveErr) {
            console.error('[summarizer] failed to clear active_agent_message_id:', saveErr);
        }

        // Push error event + mark DO as errored
        try {
            const serialized = serializeException(error);
            await streamDO.push([{ type: 'error', error: serialized.message || 'Summarization failed' }]);
            await streamDO.done();
            await streamDO.finalize();
        } catch {
            /* DO might already be gone */
        } finally {
            await ugStub.systemAction(`chat:${chatId}`, 'clearStream', {}).catch(() => {});
        }
    }
}
