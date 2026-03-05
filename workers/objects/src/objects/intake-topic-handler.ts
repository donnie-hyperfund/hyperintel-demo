import { z } from 'zod';
import { ServerMsg } from '@/lib/schema/ws-protocol';
import { StreamTopicHandler } from './stream-topic-handler';
import type { ActionResult } from './topic-handler';

// ============================================================================
// HANDLER-SPECIFIC ZOD SCHEMAS (handler owns its own validation)
// ============================================================================

const RegisterStreamActionSchema = z.object({
    identifier: z.string(),
    agentMessageId: z.string(),
    userId: z.string().optional(),
    userMessageId: z.string(),
});

const ClearStreamActionSchema = z.object({ identifier: z.string() });
const MessageCreatedActionSchema = z.object({
    identifier: z.string(),
    message: z.unknown(),
    tempId: z.string().uuid().optional(),
});

// Storage key prefix for the intake stream registry
const SK_PREFIX = 'intake:stream:';

// ============================================================================
// INTAKE TOPIC HANDLER
// ============================================================================

/**
 * IntakeTopicHandler — domain-specific handler for intake chat subscriptions.
 *
 * Extends StreamTopicHandler which provides:
 *  - canSubscribe() / subscribe() / unsubscribe() — shared stream lifecycle
 *  - resolveStream() / getStreamStub() — ChatStreamDO lookup helpers
 *  - abort action handling
 *
 * This class adds:
 *  - checkPermission() — user owns the intake chat (type: 'intake', direct user ownership)
 *  - registerStream / clearStream — system actions from the intake worker
 *
 * No tool approval actions — intake document tools are not approval-gated.
 */
export class IntakeTopicHandler extends StreamTopicHandler {
    // ========================================================================
    // STORAGE KEY PREFIX
    // ========================================================================

    protected get skPrefix(): string {
        return SK_PREFIX;
    }

    // ========================================================================
    // PERMISSION CHECK
    // ========================================================================

    /**
     * Permission: user owns the intake chat directly (not via project).
     * Intake chats have type = 'intake' and are linked to user via user_id.
     */
    async checkPermission(userId: string, chatId: string, env: Env): Promise<boolean> {
        const sql = await this.getSql(env);
        const rows = await sql`
			SELECT 1 FROM chats c
			JOIN users u ON c.user_id = u.id
			WHERE c.id = ${chatId} AND c.type = 'intake' AND u.clerk_id = ${userId}
			LIMIT 1
		`;
        return rows.length > 0;
    }

    // ========================================================================
    // ACTION HANDLING
    // ========================================================================

    async handleAction(_userId: string, action: string, payload: unknown, env: Env): Promise<ActionResult | void> {
        switch (action) {
            case 'registerStream': {
                const {
                    identifier: chatId,
                    agentMessageId,
                    userId,
                    userMessageId,
                } = RegisterStreamActionSchema.parse(payload);
                // Initialize the ChatStream DO before storing mapping
                const stub = this.getStreamStub(env, agentMessageId);
                await stub.init(chatId, agentMessageId, userMessageId, 'intake');
                // Auto-subscribe the initiating user so events reach them even if
                // they subscribed to the UG topic before the stream started.
                if (userId) {
                    await stub.subscribe(userId, userId);
                }
                // Store mapping in DO storage
                await this.storage.put(`${SK_PREFIX}${chatId}`, agentMessageId);
                // Broadcast stream_started so existing subscribers set agentMessageId state
                return {
                    broadcast: {
                        topic: `intake:${chatId}`,
                        type: ServerMsg.StreamStarted,
                        agentMessageId,
                        userMessageId,
                    },
                };
            }

            case 'messageCreated': {
                const { identifier: chatId, message, tempId } = MessageCreatedActionSchema.parse(payload);
                return {
                    broadcast: { topic: `intake:${chatId}`, type: ServerMsg.MessageCreated, message, tempId },
                };
            }

            case 'clearStream': {
                const { identifier: chatId } = ClearStreamActionSchema.parse(payload);
                await this.storage.delete(`${SK_PREFIX}${chatId}`);
                return;
            }

            // Shared 'abort' action handled by base class
            default:
                return super.handleAction(_userId, action, payload, env);
        }
    }
}
