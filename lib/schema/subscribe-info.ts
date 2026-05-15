import { z } from 'zod';
import { StreamTopicPrefixSchema } from './stream-topic';

export const SubscribeInfoRequestSchema = z.object({
    userId: z.string().min(1),
    // TODO: Carrying topic plus prefix/identifier is awkward duplication.
    // It currently lets services fail closed on internal caller mismatches.
    topic: z.string().min(1),
    prefix: StreamTopicPrefixSchema,
    identifier: z.string().min(1),
    previewAlias: z.string().min(1).nullish(),
});

export type SubscribeInfoRequest = z.infer<typeof SubscribeInfoRequestSchema>;

export const SubscribeInfoResponseSchema = z.object({
    allowed: z.boolean(),
    /** Currently-active agent message id for this chat topic. Replaces the
     *  UG-side mapping cache: subscribe uses this to address the right
     *  ChatStreamDO. Null when no stream is currently active. */
    activeAgentMessageId: z.string().nullable().optional(),
    selectedModel: z.string().nullable().optional(),
    completionBriefStatus: z.string().nullable().optional(),
});

export type SubscribeInfoResponse = z.infer<typeof SubscribeInfoResponseSchema>;
