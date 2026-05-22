import { z } from 'zod';
import { StreamTopicPrefixSchema } from './stream-topic';

export const ClearActiveStreamRequestSchema = z.object({
    // TODO: Carrying topic plus prefix/identifier is awkward duplication.
    // It currently lets services fail closed on internal caller mismatches.
    topic: z.string().min(1),
    prefix: StreamTopicPrefixSchema,
    identifier: z.string().min(1),
    // ChatStreamDO is currently named by agentMessageId, so this is the de facto
    // stream id used as an idempotency guard. If stream identity becomes generic,
    // rename the contract rather than leaking agent-message wording further.
    agentMessageId: z.string().min(1),
    previewAlias: z.string().min(1).nullish(),
});

export type ClearActiveStreamRequest = z.infer<typeof ClearActiveStreamRequestSchema>;

export const DeadManCleanupRequestSchema = ClearActiveStreamRequestSchema;
export type DeadManCleanupRequest = z.infer<typeof DeadManCleanupRequestSchema>;

export const StreamParityDebugRequestSchema = z.object({
    agentMessageId: z.string().min(1),
    previewAlias: z.string().min(1).nullish(),
    debug: z.object({
        seqHigh: z.number(),
        divergence: z.string().min(1),
        trigger: z.string().min(1),
        localSnapshot: z.unknown(),
        stateSnapshot: z.unknown(),
        createdAt: z.string().min(1),
    }),
});

export type StreamParityDebugRequest = z.infer<typeof StreamParityDebugRequestSchema>;
