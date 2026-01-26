import { runAgentStream } from '@common/ai/agent';
import { AIParamsType, type ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { serializeException } from '@common/ai/utils';
import { getLangfusePromptRaw } from '@worker/vendor/langfuse-prompts';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { SummarizeActionDto } from '@/lib/schema/chat';
import { Ctx } from './context';

export interface SummarizerOptions {
    overrideInference?: ParamsWithType;
}

const FALLBACK_SUMMARIZER_PROMPT = `You are a conversation summarizer. Your task is to create a comprehensive summary of the chat conversation that has taken place.

## Instructions

1. **Synthesize the conversation** - Capture the key discussion points, decisions made, and conclusions reached.

2. **Preserve important details** - Include any specific requirements, constraints, or important context that was established.

3. **Note any documents created** - If any documents, plans, or artifacts were generated during the conversation, explicitly mention them with their titles and key contents. This is critical for continuity.

4. **Capture action items** - If there are any pending tasks or next steps discussed, include them.

5. **Maintain context** - The summary should allow someone to pick up the conversation and understand:
   - What was discussed
   - What was decided
   - What was created/accomplished
   - What remains to be done

## Format

Write the summary as a clear, well-organized narrative. Use markdown formatting for readability:
- Use headers for major sections if the conversation covered multiple topics
- Use bullet points for lists of items, action items, or documents
- Bold important terms, decisions, or document names

Keep the summary concise but comprehensive - capture everything needed for continuity without unnecessary verbosity.`;

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

async function getSummarizerPrompt(ctx: Ctx): Promise<string> {
    // biome-ignore lint/correctness/noConstantCondition: omg
    if (true) return FALLBACK_SUMMARIZER_PROMPT;
    try {
        const prompt = await getLangfusePromptRaw(ctx.langfuse, 'pma/summarizer');
        return prompt || FALLBACK_SUMMARIZER_PROMPT;
    } catch {
        return FALLBACK_SUMMARIZER_PROMPT;
    }
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

        const documents = extractDocuments(messages);
        const basePrompt = await getSummarizerPrompt(ctx);

        let instructions = basePrompt;
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

        const inferenceParams = options.overrideInference ?? {
            paramsType: AIParamsType.Anthropic,
            params: { model: ANTHROPIC_MODELS.SONNET },
        };

        const { stream, historyPromise } = runAgentStream(
            {},
            ctx,
            {
                ...inferenceParams,
                instructions,
                context: historyMessages,
                countReasoningAsContent: false,
                contentThreshold: 5,
            },
            [],
            { config: { maxToolCalls: 0 } },
        );

        let summaryContent = '';

        for await (const event of stream) {
            switch (event.type) {
                case 'delta':
                    summaryContent += event.content;
                    enqueue({ type: 'delta', text: event.content });
                    break;
                case 'error':
                    enqueue({ type: 'error', error: String(event.error) });
                    break;
                default:
                    break;
            }
        }

        await historyPromise;

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
