import { z } from 'zod';
import type { StreamEvent, StreamSnapshot, StreamStatus } from './stream';

// ============================================================================
// WIRE PROTOCOL CONSTANTS — single source of truth for all string literals
// ============================================================================

/** Client → server action discriminant values */
export const ClientAction = {
    Subscribe: 'subscribe',
    Unsubscribe: 'unsubscribe',
    Action: 'action',
    UpdateSession: 'update-session',
} as const;

/** Server → client message type values */
export const ServerMsg = {
    Hello: 'hello',
    Error: 'error',
    SubscribeResponse: 'subscribe_response',
    StreamEvent: 'stream_event',
    StreamStatus: 'stream_status',
    StreamStarted: 'stream_started',
    MessageCreated: 'message_created',
    UserEvent: 'user_event',
    ModelChanged: 'model_changed',
    CbStatusChanged: 'cb_status_changed',
} as const;

// ============================================================================
// CLIENT → SERVER MESSAGES (Zod-validated at UG)
// ============================================================================

export const SubscribeMessageSchema = z.object({
    action: z.literal(ClientAction.Subscribe),
    topic: z.string(),
});
export type SubscribeMessage = z.infer<typeof SubscribeMessageSchema>;

export const UnsubscribeMessageSchema = z.object({
    action: z.literal(ClientAction.Unsubscribe),
    topic: z.string(),
});
export type UnsubscribeMessage = z.infer<typeof UnsubscribeMessageSchema>;

/**
 * Generic envelope for domain-specific actions.
 * The handler for the topic prefix validates `type` + `payload`.
 */
export const ActionMessageSchema = z.object({
    action: z.literal(ClientAction.Action),
    topic: z.string(),
    type: z.string(),
    payload: z.unknown().optional(),
});
export type ActionMessage = z.infer<typeof ActionMessageSchema>;

export const UpdateSessionMessageSchema = z.object({
    action: z.literal(ClientAction.UpdateSession),
    accessToken: z.string(),
});
export type UpdateSessionMessage = z.infer<typeof UpdateSessionMessageSchema>;

/** Discriminated union of all client → server messages */
export const ClientMessageSchema = z.discriminatedUnion('action', [
    SubscribeMessageSchema,
    UnsubscribeMessageSchema,
    ActionMessageSchema,
    UpdateSessionMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ============================================================================
// SERVER → CLIENT MESSAGES
// ============================================================================

// --- Subscribe responses (3 variants) ---

export type SubscribeResponseIdle = {
    topic: string;
    type: typeof ServerMsg.SubscribeResponse;
    status: 'idle';
    // Keep idle subscribe responses minimal: no `seqHigh` (no active stream to deduplicate against).
    selectedModel?: string | null;
    completionBriefStatus?: string | null;
};

export type SubscribeResponseStreaming = {
    topic: string;
    type: typeof ServerMsg.SubscribeResponse;
    status: 'streaming';
    agentMessageId: string;
    snapshot: StreamSnapshot;
    /** @same as event `_seq`; FE drops buffered/live events with `_seq <= seqHigh` after applying the snapshot. */
    seqHigh?: number;
    /** Present when streaming a summary (not a normal chat response) */
    streamType?: 'chat' | 'summary';
    selectedModel?: string | null;
    completionBriefStatus?: string | null;
};

export type SubscribeResponseStale = {
    topic: string;
    type: typeof ServerMsg.SubscribeResponse;
    status: 'stale';
    selectedModel?: string | null;
    completionBriefStatus?: string | null;
};

export type SubscribeResponse = SubscribeResponseIdle | SubscribeResponseStreaming | SubscribeResponseStale;

// --- Chat-specific stream messages (produced by ChatTopicHandler) ---

export type StreamEventMessage = {
    topic: string;
    type: typeof ServerMsg.StreamEvent;
    agentMessageId: string;
    event: StreamEvent;
    _seq?: number;
};

export type StreamStatusMessage = {
    topic: string;
    type: typeof ServerMsg.StreamStatus;
    status: StreamStatus;
    agentMessageId: string;
    _seq?: number;
};

export type StreamStartedMessage = {
    topic: string;
    type: typeof ServerMsg.StreamStarted;
    agentMessageId: string;
    userMessageId?: string;
    tempId?: string;
    /** Present when streaming a summary (not a normal chat response) */
    streamType?: 'chat' | 'summary';
};

export type ChatMessageCreatedMessage = {
    topic: string;
    type: typeof ServerMsg.MessageCreated;
    message: unknown;
    tempId?: string;
};

export type ModelChangedMessage = {
    topic: string;
    type: typeof ServerMsg.ModelChanged;
    model: string;
};

export type CbStatusChangedMessage = {
    topic: string;
    type: typeof ServerMsg.CbStatusChanged;
    status: string;
};

// --- Connection management ---

export type HelloMessage = {
    type: typeof ServerMsg.Hello;
    userId: string;
    sessionExpiresAt?: number;
};

export type ErrorMessage = {
    type: typeof ServerMsg.Error;
    error: string;
    action?: string;
};

// --- User-scoped broadcast events (no topic — sent to all user WS connections) ---

/** User-scoped broadcast event payload */
export type UserEventMessage = {
    type: typeof ServerMsg.UserEvent;
    eventType: string; // e.g. 'artifact_version_created', 'project_created'
    payload: unknown; // event-specific data — keep minimal (IDs, status, name)
};

// --- Topic message wrapper ---

/** Any message routed to a specific topic */
export type TopicMessage =
    | SubscribeResponse
    | StreamEventMessage
    | StreamStatusMessage
    | StreamStartedMessage
    | ChatMessageCreatedMessage
    | ModelChangedMessage
    | CbStatusChangedMessage;

/** All possible server → client messages */
export type ServerMessage = TopicMessage | HelloMessage | ErrorMessage | UserEventMessage;
