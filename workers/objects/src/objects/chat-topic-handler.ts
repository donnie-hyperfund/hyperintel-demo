import { z } from 'zod';
import { ServerMsg } from '@/lib/schema/ws-protocol';
import { StreamTopicHandler } from './stream-topic-handler';
import type { ActionResult, SubscribeResponse } from './topic-handler';

// ============================================================================
// HANDLER-SPECIFIC ZOD SCHEMAS (NOT in ws-protocol.ts — handler owns its own validation)
// ============================================================================

const ToolApproveActionSchema = z.object({ identifier: z.string(), toolCallId: z.string() });
const ToolRejectActionSchema = z.object({ identifier: z.string(), toolCallId: z.string() });
const RegisterStreamActionSchema = z.object({
    identifier: z.string(),
    agentMessageId: z.string(),
    userId: z.string().optional(),
    userMessageId: z.string().optional(),
    /** Distinguishes a summary stream from a normal chat response */
    streamType: z.enum(['chat', 'summary']).optional(),
});
const ClearStreamActionSchema = z.object({ identifier: z.string() });
const MessageCreatedActionSchema = z.object({
    identifier: z.string(),
    message: z.unknown(),
    tempId: z.string().uuid().optional(),
});

// Storage key prefix for the chat stream registry
const SK_PREFIX = 'chat:stream:';
/** Storage key suffix for streamType — stored alongside agentMessageId */
const SK_STREAM_TYPE_SUFFIX = ':type';

// ============================================================================
// CHAT TOPIC HANDLER
// ============================================================================

/**
 * ChatTopicHandler — domain-specific handler for chat subscriptions and actions.
 *
 * Extends StreamTopicHandler which provides:
 *  - canSubscribe() / subscribe() / unsubscribe() — shared stream lifecycle
 *  - resolveStream() / getStreamStub() — ChatStreamDO lookup helpers
 *  - abort action handling
 *
 * This class adds:
 *  - checkPermission() — user→project→chat DB query
 *  - registerStream / clearStream / messageCreated — system actions from Workers
 *  - tool_approve / tool_reject — client actions forwarded to ChatStreamDO
 *  - subscribe() override — appends streamType to the streaming response
 */
export class ChatTopicHandler extends StreamTopicHandler {
    // ========================================================================
    // STORAGE KEY PREFIX
    // ========================================================================

    protected get skPrefix(): string {
        return SK_PREFIX;
    }

    // ========================================================================
    // PERMISSION CHECK
    // ========================================================================

    async checkPermission(userId: string, chatId: string, env: Env): Promise<boolean> {
        const sql = await this.getSql(env);
        const rows = await sql`
			SELECT 1 FROM chats c
			JOIN projects p ON c.project_id = p.id
			JOIN users u ON p.user_id = u.id
			WHERE c.id = ${chatId} AND u.clerk_id = ${userId}
			LIMIT 1
		`;
        return rows.length > 0;
    }

    // ========================================================================
    // STREAM KEY CLEANUP — also deletes the streamType suffix key
    // ========================================================================

    protected async cleanupStreamKeys(identifier: string): Promise<void> {
        await this.storage.delete(`${SK_PREFIX}${identifier}`);
        await this.storage.delete(`${SK_PREFIX}${identifier}${SK_STREAM_TYPE_SUFFIX}`);
    }

    // ========================================================================
    // SUBSCRIBE OVERRIDE — includes streamType in streaming response
    // ========================================================================

    async subscribe(userId: string, identifier: string, env: Env): Promise<SubscribeResponse> {
        const base = await super.subscribe(userId, identifier, env);
        if (base.status !== 'streaming') return base;

        // Read the streamType that was stored by registerStream (may be absent for normal chat)
        const streamType = await this.storage.get<'chat' | 'summary'>(
            `${SK_PREFIX}${identifier}${SK_STREAM_TYPE_SUFFIX}`,
        );
        if (!streamType || streamType === 'chat') return base;

        return { ...base, streamType };
    }

    // ========================================================================
    // ACTION HANDLING
    // ========================================================================

    async handleAction(_userId: string, action: string, payload: unknown, env: Env): Promise<ActionResult | void> {
        switch (action) {
            // --- System actions (called by Workers via UG.systemAction RPC) ---
            case 'registerStream': {
                const {
                    identifier: chatId,
                    agentMessageId,
                    userId,
                    userMessageId,
                    streamType,
                } = RegisterStreamActionSchema.parse(payload);
                // Initialize the ChatStream DO before storing mapping or broadcasting
                const stub = this.getStreamStub(env, agentMessageId);
                await stub.init(chatId, agentMessageId, userMessageId ?? '');
                // Auto-subscribe the initiating user so events reach them even if
                // they subscribed to the UG topic before the stream started.
                // UG DO name = userId (keyed via idFromName).
                if (userId) {
                    await stub.subscribe(userId, userId);
                }
                // Store agentMessageId mapping and (if present) streamType
                await this.storage.put(`${SK_PREFIX}${chatId}`, agentMessageId);
                if (streamType && streamType !== 'chat') {
                    await this.storage.put(`${SK_PREFIX}${chatId}${SK_STREAM_TYPE_SUFFIX}`, streamType);
                }
                return {
                    broadcast: {
                        topic: `chat:${chatId}`,
                        type: ServerMsg.StreamStarted,
                        agentMessageId,
                        ...(userMessageId && { userMessageId }),
                        ...(streamType && streamType !== 'chat' && { streamType }),
                    },
                };
            }
            case 'messageCreated': {
                const { identifier: chatId, message, tempId } = MessageCreatedActionSchema.parse(payload);
                return {
                    broadcast: { topic: `chat:${chatId}`, type: ServerMsg.MessageCreated, message, tempId },
                };
            }
            case 'clearStream': {
                const { identifier: chatId } = ClearStreamActionSchema.parse(payload);
                await this.storage.delete(`${SK_PREFIX}${chatId}`);
                // Also clear any streamType entry
                await this.storage.delete(`${SK_PREFIX}${chatId}${SK_STREAM_TYPE_SUFFIX}`);
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

            // --- Shared actions (handled by base class) ---
            default:
                return super.handleAction(_userId, action, payload, env);
        }
    }
}
