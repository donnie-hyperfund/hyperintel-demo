import { type SystemActionRequest, SystemActionRequestSchema } from '@/lib/schema/system-actions';
import {
    type CbStatusChangedMessage,
    type ChatMessageCreatedMessage,
    type ModelChangedMessage,
    ServerMsg,
    type StreamStartedMessage,
} from '@/lib/schema/ws-protocol';
import { branchDoName } from '@/workers/_common/util/preview-alias';

// ============================================================================
// SYSTEM ACTION DISPATCHER
// ============================================================================
//
// What services owns for system actions:
//   - Parse the discriminated-union request.
//   - For registerStream: call ChatStreamDO.init + auto-subscribe initiator,
//     then broadcast `stream_started` via UG.broadcastToTopic.
//   - For pure broadcasts (messageCreated / modelChanged / cbStatusChanged):
//     build the ServerMsg shape and call UG.broadcastToTopic. Nothing else.
//
// Routing — "which agentMessageId is the active stream for this chat topic" —
// lives in `chats.active_agent_message_id` in SQL. Subscribers read it via
// getTopicSubscribeInfo. The UG no longer keeps a mapping cache; ChatStreamDO
// does not write any UG-side state.
//
// External UG RPC surface: `broadcastToTopic(topic, message)` only.
// Caller-side telemetry (services_*_rpc data points) is wired in hi-chat.
// ============================================================================

// Stub return types are inferred from the auto-generated ServicesEnv bindings
// (worker-configuration.d.ts → DurableObjectNamespace<UserGateway> /
// DurableObjectNamespace<ChatStreamDO>). Letting TS infer them — rather than
// re-declaring a placeholder interface and casting `as unknown as Placeholder` —
// means any drift between this caller and the real DO signatures is a compile
// error here, not a silent runtime mismatch.

function getUserGateway(env: ServicesEnv, userId: string, previewAlias: string | null | undefined) {
    const name = branchDoName(userId, previewAlias ?? null);
    return env.USER_GATEWAY.get(env.USER_GATEWAY.idFromName(name));
}

function getChatStream(env: ServicesEnv, agentMessageId: string, previewAlias: string | null | undefined) {
    const name = branchDoName(agentMessageId, previewAlias ?? null);
    return env.CHAT_STREAM_DO.get(env.CHAT_STREAM_DO.idFromName(name));
}

function topicName(prefix: 'chat' | 'intake', identifier: string): string {
    return `${prefix}:${identifier}`;
}

/**
 * Build the ServerMsg payload for a broadcast-bearing action.
 *
 * Strongly typed as the concrete TopicMessage variants — TS will error if any
 * branch forgets a required field (notably `topic`, which the FE filters on
 * and would silently drop without).
 */
function buildBroadcastMessage(
    req: SystemActionRequest,
    topic: string,
): StreamStartedMessage | ChatMessageCreatedMessage | ModelChangedMessage | CbStatusChangedMessage {
    switch (req.action) {
        case 'registerStream':
            return {
                topic,
                type: ServerMsg.StreamStarted,
                agentMessageId: req.agentMessageId,
                ...(req.userMessageId && { userMessageId: req.userMessageId }),
                ...(req.streamType && req.streamType !== 'chat' && { streamType: req.streamType }),
            };
        case 'messageCreated':
            return {
                topic,
                type: ServerMsg.MessageCreated,
                message: req.message,
                ...(req.tempId && { tempId: req.tempId }),
            };
        case 'modelChanged':
            return { topic, type: ServerMsg.ModelChanged, model: req.model };
        case 'cbStatusChanged':
            return { topic, type: ServerMsg.CbStatusChanged, status: req.status };
        default: {
            // Exhaustive over SystemActionRequest['action']. If a new action is
            // added without a case here, the never assignment is a TS error AND
            // this throws at runtime.
            const _exhaustive: never = req;
            void _exhaustive;
            throw new Error(`buildBroadcastMessage: unhandled action ${(req as { action: string }).action}`);
        }
    }
}

// ============================================================================
// PUBLIC ENTRYPOINT
// ============================================================================

/**
 * Generic system-action dispatcher. Single entrypoint, discriminated-union request.
 *
 * Adding a new action: extend SystemActionRequestSchema and add a case below.
 * Adding a new action does NOT require redeploying hi-objects — UG only exposes
 * `broadcastToTopic` externally and stays domain-blind.
 */
export async function handleSystemAction(env: ServicesEnv, raw: unknown): Promise<void> {
    const req = SystemActionRequestSchema.parse(raw);
    const ug = getUserGateway(env, req.userId, req.previewAlias);
    const topic = topicName(req.prefix, req.identifier);

    switch (req.action) {
        case 'registerStream': {
            // Two cross-DO calls to hi-objects:
            //   1. ChatStreamDO.init — sets up stream state.
            //   2. ChatStreamDO.subscribe — auto-subscribe the initiator so
            //      they receive events even if they connected before the stream.
            // Routing ("which agentMessageId is active for this chat topic") is
            // owned by chats.active_agent_message_id in SQL, read on subscribe
            // via getTopicSubscribeInfo. The DO doesn't write any UG-side state.
            const stream = getChatStream(env, req.agentMessageId, req.previewAlias);
            // Signature: (chatId, agentMessageId, userMessageId, topicPrefix, previewAlias?, streamType?)
            await stream.init(
                req.identifier,
                req.agentMessageId,
                req.userMessageId ?? '',
                req.prefix,
                req.previewAlias ?? undefined,
                req.streamType,
            );
            await stream.subscribe(req.userId, branchDoName(req.userId, req.previewAlias ?? null));
            await ug.broadcastToTopic(topic, buildBroadcastMessage(req, topic));
            return;
        }

        case 'messageCreated':
        case 'modelChanged':
        case 'cbStatusChanged': {
            // Runtime guard: modelChanged / cbStatusChanged are chat-only by current
            // product semantics. Schema keeps `prefix` open (generic-first); reject
            // unsupported combinations here so the failure is loud and localized.
            if ((req.action === 'modelChanged' || req.action === 'cbStatusChanged') && req.prefix !== 'chat') {
                throw new Error(`${req.action} is only supported for prefix 'chat', got '${req.prefix}'`);
            }
            await ug.broadcastToTopic(topic, buildBroadcastMessage(req, topic));
            return;
        }

        default: {
            const _exhaustive: never = req;
            void _exhaustive;
            throw new Error(`handleSystemAction: unhandled action ${(req as { action: string }).action}`);
        }
    }
}
