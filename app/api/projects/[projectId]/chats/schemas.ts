import { z } from 'zod';

export const ListChatsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
});
export type ListChatsQueryDto = z.infer<typeof ListChatsQuerySchema>;

export const ListMessagesQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    authorType: z.enum(['USER', 'AI']).optional(),
});
export type ListMessagesQueryDto = z.infer<typeof ListMessagesQuerySchema>;

export const CreateMessageBodySchema = z.object({
    content: z.string().trim().min(1, 'Message content is required'),
    authorType: z.enum(['USER', 'AI'], {
        errorMap: () => ({ message: 'authorType must be USER or AI' }),
    }),
    metadata: z.record(z.unknown()).optional(),
});
export type CreateMessageBodyDto = z.infer<typeof CreateMessageBodySchema>;

export const UpdateMessageBodySchema = z.object({
    content: z.string().trim().min(1, 'Message content is required'),
});
export type UpdateMessageBodyDto = z.infer<typeof UpdateMessageBodySchema>;

export const ChatResponseSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    id: z.string().uuid(),
    messageCount: z.number().int(),
    firstMessageContent: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type ChatResponseDto = z.infer<typeof ChatResponseSchema>;

export const MessageResponseSchema = z.object({
    id: z.string().uuid(),
    content: z.string(),
    authorType: z.enum(['USER', 'AI']),
    chatId: z.string().uuid(),
    metadata: z.record(z.unknown()).nullable(),
    createdAt: z.string(),
});
export type MessageResponseDto = z.infer<typeof MessageResponseSchema>;
