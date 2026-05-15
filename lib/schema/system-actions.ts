import { z } from 'zod';
import { StreamTopicPrefixSchema } from './stream-topic';

// ============================================================================
// SYSTEM ACTION REQUEST SCHEMAS
// ============================================================================
//
// Discriminated union of every system action fired at hi-services. Services
// parses the union, builds the appropriate ServerMsg shape, and broadcasts
// via UG.broadcastToTopic. For registerStream, services also calls
// ChatStreamDO.init + subscribe (initiator auto-subscribe).
//
// Adding a new action: add a variant here, add a case in
// workers/services/src/chat/system-actions.ts. No hi-objects deploy needed.
//
// Removed actions:
//   - clearStream — ChatStreamDO clears its own UG mapping on finalize()
//     (intra-worker call inside hi-objects). No external caller needed.
//
// Fields shared by every variant:
//   - prefix       — topic namespace ('chat' | 'intake')
//   - identifier   — chatId (or intake id)
//   - userId       — UG owner whose sockets receive the broadcast (== initiator)
//   - previewAlias — dev preview branch alias for DB / DO name resolution
// ============================================================================

const baseFields = {
    prefix: StreamTopicPrefixSchema,
    identifier: z.string().min(1),
    userId: z.string().min(1),
    previewAlias: z.string().min(1).nullish(),
};

export const RegisterStreamRequestSchema = z.object({
    action: z.literal('registerStream'),
    ...baseFields,
    agentMessageId: z.string().min(1),
    userMessageId: z.string().optional(),
    /** Distinguishes a summary stream from a normal chat response. Chat-only in practice. */
    streamType: z.enum(['chat', 'summary']).optional(),
});
export type RegisterStreamRequest = z.infer<typeof RegisterStreamRequestSchema>;

export const MessageCreatedRequestSchema = z.object({
    action: z.literal('messageCreated'),
    ...baseFields,
    message: z.unknown(),
    tempId: z.string().uuid().optional(),
});
export type MessageCreatedRequest = z.infer<typeof MessageCreatedRequestSchema>;

export const ModelChangedRequestSchema = z.object({
    action: z.literal('modelChanged'),
    ...baseFields,
    model: z.string().min(1),
});
export type ModelChangedRequest = z.infer<typeof ModelChangedRequestSchema>;

export const CbStatusChangedRequestSchema = z.object({
    action: z.literal('cbStatusChanged'),
    ...baseFields,
    status: z.string().min(1),
});
export type CbStatusChangedRequest = z.infer<typeof CbStatusChangedRequestSchema>;

export const SystemActionRequestSchema = z.discriminatedUnion('action', [
    RegisterStreamRequestSchema,
    MessageCreatedRequestSchema,
    ModelChangedRequestSchema,
    CbStatusChangedRequestSchema,
]);

export type SystemActionRequest = z.infer<typeof SystemActionRequestSchema>;
export type SystemActionName = SystemActionRequest['action'];
