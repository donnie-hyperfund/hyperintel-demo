import { SendChatActionDto } from "@/lib/schema/chat";
import { Ctx } from "./context";
import { getLangfusePromptRaw } from "@worker/vendor/langfuse-prompts";
import { ChatMessageEntity } from "@/lib/orm/entities/chats/chat-message.entity";
import { ChatEntity } from "@/lib/orm/entities/chats/chat.entity";

async function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
async function streamInternal(
    data: SendChatActionDto,
    ctx: Ctx,
    controller: ReadableStreamDefaultController<Uint8Array>,
) {
    const { chatId, message } = data;
    const { anthropic, langfuse, em } = ctx;
    const encoder = new TextEncoder();

    try {
        // Verify chat belongs to user
        await em!.findOneOrFail(ChatEntity, { id: chatId, project: { user: { clerkId: ctx.user.userId } } });

        if (!anthropic || !langfuse) {
            throw new Error("Anthropic and Langfuse clients are required");
        }

        // Load history from database
        const dbMessages = await em!.find(
            ChatMessageEntity,
            { chat: chatId },
            { orderBy: { created_at: 'ASC' } }
        );
        const historyMessages = dbMessages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));

        // Add the new user message
        const allMessages = [
            ...historyMessages,
            { role: 'user' as const, content: message },
        ];

        // Load prompt from Langfuse
        const systemPrompt = await getLangfusePromptRaw(langfuse, 'master_prompt_silly');

        // Call Anthropic with streaming
        const anthropicStream = await anthropic.messages.stream({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: systemPrompt,
            messages: allMessages,
        });

        for await (const event of anthropicStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', text: event.delta.text })}\n\n`));
            } else if (event.type === 'message_start') {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'created', id: event.message.id })}\n\n`));
            } else if (event.type === 'message_stop') {
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            }
        }
        controller.close();
    } catch (error) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`));
        controller.close();
    }
}

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