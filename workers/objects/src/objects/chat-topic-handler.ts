import { z } from 'zod';
import { ServerMsg } from '@/lib/schema/ws-protocol';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import { StreamTopicHandler, type SubscribePolicyResult } from './stream-topic-handler';
import type { ActionResult, AllowedSubscribe, SubscribeResponse } from './topic-handler';

// ============================================================================
// HANDLER-SPECIFIC ZOD SCHEMAS (NOT in ws-protocol.ts — handler owns its own validation)
// ============================================================================

const ToolApproveActionSchema = z.object({ identifier: z.string(), toolCallId: z.string() });
const ToolRejectActionSchema = z.object({ identifier: z.string(), toolCallId: z.string() });
const DecisionSelectActionSchema = z.object({
    identifier: z.string(),
    toolCallId: z.string(),
    value: z.string(),
    /** Populated when the user picked "Other" and typed a custom answer. */
    freeText: z.string().max(2000).optional(),
});
const DecisionDismissActionSchema = z.object({ identifier: z.string(), toolCallId: z.string() });
const ModelChangedActionSchema = z.object({ identifier: z.string(), model: z.string() });
const RegisterStreamActionSchema = z.object({
    identifier: z.string(),
    agentMessageId: z.string(),
    userId: z.string().optional(),
    userMessageId: z.string().optional(),
    /** Distinguishes a phase-transition stream from a normal chat response */
    streamType: z.enum(['chat', 'phase_transition']).optional(),
});
const ClearStreamActionSchema = z.object({ identifier: z.string() });
const CbStatusChangedActionSchema = z.object({ identifier: z.string(), status: z.string() });
const MessageCreatedActionSchema = z.object({
    identifier: z.string(),
    message: z.unknown(),
    tempId: z.string().uuid().optional(),
});

// Storage key prefix for the chat stream registry
const SK_PREFIX = 'chat:stream:';
/** Storage key suffix for streamType — stored alongside agentMessageId */
const SK_STREAM_TYPE_SUFFIX = ':type';

type ChatSubscribeInfo = SubscribePolicyResult & {
    selectedModel?: string | null;
    completionBriefStatus?: string | null;
};

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
 *  - registerStream / clearStream / messageCreated — system actions from Workers
 *  - tool_approve / tool_reject — client actions forwarded to ChatStreamDO
 *  - subscribe() override — appends streamType and services-provided metadata
 */
export class ChatTopicHandler extends StreamTopicHandler<ChatSubscribeInfo> {
    protected readonly topicPrefix = 'chat';

    // ========================================================================
    // STORAGE KEY PREFIX
    // ========================================================================

    protected get skPrefix(): string {
        return SK_PREFIX;
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

    async subscribe(
        userId: string,
        identifier: string,
        env: ObjectsEnv,
        decision: AllowedSubscribe<ChatSubscribeInfo>,
    ): Promise<SubscribeResponse> {
        const subscribeInfo = decision.subscribeInfo;
        const base = await super.subscribe(userId, identifier, env, decision);
        const selectedModel = subscribeInfo.selectedModel ?? null;
        const completionBriefStatus = subscribeInfo.completionBriefStatus ?? null;

        if (base.status !== 'streaming') {
            return { ...base, selectedModel, completionBriefStatus };
        }

        // Read the streamType that was stored by registerStream (may be absent for normal chat)
        const streamType = await this.storage.get<'chat' | 'phase_transition'>(
            `${SK_PREFIX}${identifier}${SK_STREAM_TYPE_SUFFIX}`,
        );
        if (!streamType || streamType === 'chat') return { ...base, selectedModel, completionBriefStatus };

        return { ...base, streamType, selectedModel, completionBriefStatus };
    }

    // ========================================================================
    // ACTION HANDLING
    // ========================================================================

    async handleAction(
        _userId: string,
        action: string,
        payload: unknown,
        env: ObjectsEnv,
    ): Promise<ActionResult | void> {
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
                await stub.init(chatId, agentMessageId, userMessageId ?? '', 'chat', this.previewAlias ?? undefined);
                // Auto-subscribe the initiating user so events reach them even if
                // they subscribed to the UG topic before the stream started.
                // UG DO name = userId (or userId@alias on dev preview branches).
                if (userId) {
                    await stub.subscribe(userId, branchDoName(userId, this.previewAlias));
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
            case 'modelChanged': {
                const { identifier: chatId, model } = ModelChangedActionSchema.parse(payload);
                return {
                    broadcast: {
                        topic: `chat:${chatId}`,
                        type: ServerMsg.ModelChanged,
                        model,
                    },
                };
            }
            case 'cbStatusChanged': {
                const { identifier: chatId, status } = CbStatusChangedActionSchema.parse(payload);
                return {
                    broadcast: {
                        topic: `chat:${chatId}`,
                        type: ServerMsg.CbStatusChanged,
                        status,
                    },
                };
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
            case 'decision_dismiss': {
                const { identifier: chatId, toolCallId } = DecisionDismissActionSchema.parse(payload);
                const stub = await this.resolveStream(chatId, env);
                if (stub) await stub.decisionDismiss(toolCallId);
                return;
            }

            // --- Shared actions (handled by base class) ---
            default:
                return super.handleAction(_userId, action, payload, env);
        }
    }
}
