import { z } from 'zod';
import { StreamTopicHandler, type SubscribePolicyResult } from './stream-topic-handler';
import type { AllowedSubscribe, SubscribeResponse } from './topic-handler';

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
 *  - tool_approve / tool_reject — client actions forwarded to ChatStreamDO
 *  - subscribe() override — appends streamType and services-provided metadata
 */
export class ChatTopicHandler extends StreamTopicHandler<ChatSubscribeInfo> {
    protected readonly topicPrefix = 'chat';

    // ========================================================================
    // SUBSCRIBE OVERRIDE — appends model/CB metadata + streamType from the DO
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

        // streamType comes from ChatStreamDO.subscribe() (set on init when known).
        // Plain 'chat' streams omit it from the response.
        const streamType = base.streamType;
        if (!streamType || streamType === 'chat') return { ...base, selectedModel, completionBriefStatus };
        return { ...base, streamType, selectedModel, completionBriefStatus };
    }

    // ========================================================================
    // ACTION HANDLING
    // ========================================================================

    async handleAction(userId: string, action: string, payload: unknown, env: ObjectsEnv): Promise<void> {
        switch (action) {
            // --- Client actions (forwarded to ChatStream DO) ---
            case 'tool_approve': {
                const { identifier: chatId, toolCallId } = ToolApproveActionSchema.parse(payload);
                const stub = await this.resolveStream(userId, chatId, env);
                if (stub) await stub.toolApprove(toolCallId);
                return;
            }
            case 'tool_reject': {
                const { identifier: chatId, toolCallId } = ToolRejectActionSchema.parse(payload);
                const stub = await this.resolveStream(userId, chatId, env);
                if (stub) await stub.toolReject(toolCallId);
                return;
            }
            case 'decision_select': {
                const { identifier: chatId, toolCallId, value, freeText } = DecisionSelectActionSchema.parse(payload);
                const stub = await this.resolveStream(userId, chatId, env);
                if (stub) await stub.decisionSelect(toolCallId, value, freeText);
                return;
            }
            case 'decision_dismiss': {
                const { identifier: chatId, toolCallId } = DecisionDismissActionSchema.parse(payload);
                const stub = await this.resolveStream(userId, chatId, env);
                if (stub) await stub.decisionDismiss(toolCallId);
                return;
            }

            // --- Shared actions (handled by base class) ---
            default:
                return super.handleAction(userId, action, payload, env);
        }
    }
}
