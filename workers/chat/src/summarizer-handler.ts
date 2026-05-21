import { PublicError } from '@common/common/error.helpers';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { SummarizeActionDto } from '@/lib/schema/chat';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import { chatActionHandler } from './chat-handler';
import { Ctx } from './context';
import { runSummarizer, type SummarizerOptions } from './summarizer';
import { buildContextGateError } from './utils/context-gate-error';
import type { UserGatewayStub } from './utils/do-stubs';
import { findNextPhaseChat } from './utils/next-phase';
import { createEnqueue, createSSEStream } from './utils/stream-utils';

export type { SummarizerOptions } from './summarizer';

// ============================================================================
// SUMMARIZE ACTION HANDLER — SSE stream, generation runs inline (kept alive by GenerationProxyDO)
// ============================================================================

export interface SummarizeActionResult {
    agentMessageId: string;
    /** Resolves when generation completes. Present when onEvent is provided. */
    generation?: Promise<boolean>;
}

/**
 * Summarize action handler — registers stream under chat:{chatId} topic.
 * Returns SSE stream: first event = IDs, then generation runs inline.
 * In test mode (options.onEvent), returns SummarizeActionResult directly.
 */
export async function summarizeActionHandler(
    data: SummarizeActionDto,
    ctx: Ctx,
    options: SummarizerOptions = {},
): Promise<SummarizeActionResult | ReadableStream | PublicError> {
    const { chatId } = data;
    const { em } = ctx;
    ctx.userTimezone = data.timezone;

    const agentMessageId = crypto.randomUUID();

    // Validate ownership + load chat entity
    const chat = await em!.findOneOrFail(ChatEntity, {
        id: chatId,
        project: { user: { clerkId: ctx.user.userId } },
    });

    // Gate: refuse if this chat already has a next-phase chat. Direct callers of
    // /summarize would otherwise create a second next-phase chat for the same
    // source. The forced-brief path (Task 2.3b) consults the same helper.
    const nextChat = await findNextPhaseChat(em!, {
        sourceChatId: chatId,
        projectId: chat.project!.id,
    });
    if (nextChat) {
        return new PublicError(
            400,
            buildContextGateError({
                gate: 'hard',
                source: 'already_transitioned',
                canBypass: false,
                canForceBrief: false,
                existingNextChatId: nextChat.id,
            }),
        );
    }

    // Gate: require an approved Completion Brief before phase transition
    if (chat.completion_brief_status !== 'approved') {
        return new PublicError(400, {
            code: 'completion_brief_not_approved',
            message: 'Cannot transition phase without an approved Completion Brief',
            details: { currentStatus: chat.completion_brief_status ?? 'none' },
        });
    }

    // Set active_agent_message_id on the source chat (same column as normal chat responses)
    chat.active_agent_message_id = agentMessageId;
    await em!.flush();

    // Register stream under chat:{chatId} topic with streamType: 'summary'
    const alias = ctx.previewAlias;
    const ugId = ctx.env.USER_GATEWAY.idFromName(branchDoName(ctx.user.userId, alias));
    const ugStub = ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;
    await ugStub.systemAction(
        `chat:${chatId}`,
        'registerStream',
        {
            agentMessageId,
            userId: ctx.user.userId,
            streamType: 'summary',
            // summarizer does not have an initiating user message
        },
        alias ?? undefined,
    );

    // --- Test mode: keep existing direct-call behavior ---
    if (options.onEvent) {
        const generationPromise = runSummarizer(
            { data, ctx, options, chat, agentMessageId, ugStub },
            { dispatchBlurb: chatActionHandler },
        );
        return { agentMessageId, generation: generationPromise };
    }

    // --- Production mode: return SSE stream (kept alive by GenerationProxyDO) ---
    return createSSEStream(async (controller) => {
        const enqueue = createEnqueue(controller);

        // First event: IDs (read by GenerationProxyDO, returned to frontend)
        enqueue({ type: 'ids', agentMessageId });

        // SSE keepalive — prevents Cloudflare from killing the idle connection
        const heartbeat = setInterval(() => enqueue(':keepalive'), 10_000);

        try {
            await runSummarizer(
                { data, ctx, options, chat, agentMessageId, ugStub },
                { dispatchBlurb: chatActionHandler },
            );
        } finally {
            clearInterval(heartbeat);
        }

        try {
            controller.close();
        } catch {
            /* already closed */
        }
    }, ctx);
}
