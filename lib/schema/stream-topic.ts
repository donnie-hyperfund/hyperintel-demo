import { z } from 'zod';

export const StreamTopicPrefixSchema = z.enum(['chat', 'intake']);
export type StreamTopicPrefix = z.infer<typeof StreamTopicPrefixSchema>;
