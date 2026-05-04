import { z } from 'zod';
import { ServerMsg } from '@/lib/schema/ws-protocol';
import { branchDoName } from '@/workers/_common/util/preview-alias';
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
const ToolApproveActionSchema = z.object({ identifier: z.string(), toolCallId: z.string() });
const ToolRejectActionSchema = z.object({ identifier: z.string(), toolCallId: z.string() });
const DecisionSelectActionSchema = z.object({
    identifier: z.string(),
    toolCallId: z.string(),
    value: z.string(),
    /** Populated when the user picked "Other" and typed a custom answer. */
    freeText: z.string().max(2000).optional(),
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
 *  - tool_approve / tool_reject — client actions forwarded to ChatStreamDO
 *  - decision_select — client action forwarded to ChatStreamDO (resolves request_user_decision)
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
                await stub.init(chatId, agentMessageId, userMessageId, 'intake', this.previewAlias ?? undefined);
                // Auto-subscribe the initiating user so events reach them even if
                // they subscribed to the UG topic before the stream started.
                if (userId) {
                    await stub.subscribe(userId, branchDoName(userId, this.previewAlias));
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

            // --- Client actions (forwarded to ChatStream DO) ---
            case 'tool_approve': {
                const { identifier: chatId, toolCallId } = ToolApproveActionSchema.parse(payload);
                const stub = await this.resolveStream(chatId, env);
                if (stub) await stub.toolApprove(toolCallId);
                return;
            }
            case 'tool_reject': {
                const { identifier: chatId, toolCallId } = ToolRejectActionSchema.parse(payload);
                const stub = await this.resolveStream(chatId, env);
                if (stub) await stub.toolReject(toolCallId);
                return;
            }
            case 'decision_select': {
                const { identifier: chatId, toolCallId, value, freeText } = DecisionSelectActionSchema.parse(payload);
                const stub = await this.resolveStream(chatId, env);
                if (stub) await stub.decisionSelect(toolCallId, value, freeText);
                return;
            }

            // Shared 'abort' action handled by base class
            default:
                return super.handleAction(_userId, action, payload, env);
        }
    }
}
