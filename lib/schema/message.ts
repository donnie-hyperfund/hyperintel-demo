import { z } from 'zod';

export const ListChatsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
});
export type ListChatsQueryDto = z.infer<typeof ListChatsQuerySchema>;

export const ListMessagesQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    role: z.string().optional(),
});
export type ListMessagesQueryDto = z.infer<typeof ListMessagesQuerySchema>;

export const CreateMessageBodySchema = z.object({
    content: z.string().trim().min(1, 'Message content is required'),
    role: z.string(),
    metadata: z.record(z.unknown()).optional(),
});
export type CreateMessageBodyDto = z.infer<typeof CreateMessageBodySchema>;

export const ChatDtoSchema = z.object({
    id: z.string().uuid(),
    phase: z.string(),
    summary: z.string().nullable().optional(),
    project: z.union([z.string().uuid(), z.object({}).passthrough()]),
    message_count: z.number().optional(),
    first_message_content: z.string().nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    created_at: z.union([z.string(), z.date()]),
    updated_at: z.union([z.string(), z.date()]),
});
export type ChatDto = z.infer<typeof ChatDtoSchema>;

export const ChatMessageDtoSchema = z.object({
    id: z.string().uuid(),
    role: z.string(),
    content: z.string(),
    chat: z.union([z.string().uuid(), z.object({}).passthrough()]),
    metadata: z.record(z.unknown()).nullable().optional(),
    created_at: z.union([z.string(), z.date()]),
});
export type ChatMessageDto = z.infer<typeof ChatMessageDtoSchema>;

