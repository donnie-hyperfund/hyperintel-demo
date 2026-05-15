import { PublicError } from '@common/common/error.helpers';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import type { PhaseTransitionActionDto } from '@/lib/schema/chat';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import { Ctx } from './context';
import { PHASE_TRANSITION_STREAM_TYPE, type PhaseTransitionOptions, runPhaseTransition } from './phase-transition';
import { callChatServicesSystemAction } from './utils/chat-services';
import { buildContextGateError } from './utils/context-gate-error';
import type { UserGatewayStub } from './utils/do-stubs';
import { findNextPhaseChat } from './utils/next-phase';
import { createEnqueue, createSSEStream } from './utils/stream-utils';

export type { PhaseTransitionOptions } from './phase-transition';

// ============================================================================
// PHASE TRANSITION ACTION HANDLER
// ============================================================================

export interface PhaseTransitionActionResult {
    agentMessageId: string;
    /** Resolves when generation completes. Present when onEvent is provided. */
    generation?: Promise<boolean>;
}

/**
 * Registers the source-chat stream and runs the approved-brief phase transition.
 * Returns SSE stream: first event = IDs, then generation runs inline.
 * In test mode (options.onEvent), returns PhaseTransitionActionResult directly.
 */
export async function phaseTransitionActionHandler(
    data: PhaseTransitionActionDto,
    ctx: Ctx,
    options: PhaseTransitionOptions = {},
): Promise<PhaseTransitionActionResult | ReadableStream | PublicError> {
    const { chatId } = data;
    const { em } = ctx;

    const agentMessageId = crypto.randomUUID();

    // Validate ownership + load chat entity
    const chat = await em!.findOneOrFail(ChatEntity, {
        id: chatId,
        project: { user: { clerkId: ctx.user.userId } },
    });

    // Gate: refuse if this chat already has a next-phase chat. Direct endpoint
    // callers would otherwise create a second next-phase chat for the same source.
    // The forced-brief path (Task 2.3b) consults the same helper.
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

    const alias = ctx.previewAlias;
    const ugId = ctx.env.USER_GATEWAY.idFromName(branchDoName(ctx.user.userId, alias));
    const ugStub = ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;
    await callChatServicesSystemAction(ctx, {
        action: 'registerStream',
        prefix: 'chat',
        identifier: chatId,
        userId: ctx.user.userId,
        previewAlias: alias,
        agentMessageId,
        streamType: PHASE_TRANSITION_STREAM_TYPE,
    });

    // --- Test mode: keep existing direct-call behavior ---
    if (options.onEvent) {
        const generationPromise = runPhaseTransition({ data, ctx, options, chat, agentMessageId, ugStub });
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
            await runPhaseTransition({ data, ctx, options, chat, agentMessageId, ugStub });
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
