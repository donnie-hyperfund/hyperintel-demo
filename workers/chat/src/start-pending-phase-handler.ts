import { ErrorStatus, PublicError } from '@common/common/error.helpers';
import type { StartPendingPhaseActionDto } from '@/lib/schema/chat';
import { type ChatHandlerOptions, chatActionHandler } from './chat-handler';
import type { Ctx } from './context';
import { PENDING_PHASE_MESSAGE_METADATA_KEY } from './phase-transition';

type ClaimedPendingPhase = {
    pending_message_id: string | null;
};

async function claimPendingPhaseMessage(opts: { ctx: Ctx; chatId: string }): Promise<string | null> {
    const { ctx, chatId } = opts;
    const rows = (await ctx.em!.getConnection().execute(
        `
        WITH claimed AS (
            SELECT c.id, c.metadata ->> ? AS pending_message_id
            FROM chats c
            JOIN projects p ON p.id = c.project_id
            JOIN users u ON u.id = p.user_id
            WHERE c.id = ?
              AND u.clerk_id = ?
              AND c.active_agent_message_id IS NULL
              AND jsonb_exists(c.metadata, ?)
            FOR UPDATE
        ),
        updated AS (
            UPDATE chats c
            SET metadata = c.metadata - ?
            FROM claimed
            WHERE c.id = claimed.id
            RETURNING c.id
        )
        SELECT claimed.pending_message_id
        FROM claimed
        JOIN updated ON true
        `,
        [
            PENDING_PHASE_MESSAGE_METADATA_KEY,
            chatId,
            ctx.user.userId,
            PENDING_PHASE_MESSAGE_METADATA_KEY,
            PENDING_PHASE_MESSAGE_METADATA_KEY,
        ],
    )) as ClaimedPendingPhase[];

    return rows[0]?.pending_message_id ?? null;
}

export async function startPendingPhaseActionHandler(
    data: StartPendingPhaseActionDto,
    ctx: Ctx,
    options: ChatHandlerOptions = {},
) {
    const pendingMessageId = await claimPendingPhaseMessage({ ctx, chatId: data.chatId });
    if (!pendingMessageId) {
        return new PublicError(ErrorStatus.BadRequest, {
            code: 'NO_PENDING_PHASE_START',
            message: 'No pending phase transition start was found for this chat.',
        });
    }

    return chatActionHandler({ chatId: data.chatId, message: null }, ctx, options);
}
