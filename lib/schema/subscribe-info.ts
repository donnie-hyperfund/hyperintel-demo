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
    selectedModel: z.string().nullable().optional(),
    completionBriefStatus: z.string().nullable().optional(),
});

export type SubscribeInfoResponse = z.infer<typeof SubscribeInfoResponseSchema>;
