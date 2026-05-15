import { z } from 'zod';
import { StreamTopicHandler } from './stream-topic-handler';

// ============================================================================
// HANDLER-SPECIFIC ZOD SCHEMAS (handler owns its own validation)
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
 * This class adds client actions forwarded to ChatStreamDO:
 *  - tool_approve / tool_reject
 *  - decision_select / decision_dismiss
 */
export class IntakeTopicHandler extends StreamTopicHandler {
    protected readonly topicPrefix = 'intake';

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

            // Shared 'abort' action handled by base class
            default:
                return super.handleAction(userId, action, payload, env);
        }
    }
}
