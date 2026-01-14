import z from 'zod';

export const SendConversationActionSchema = z.object({
    messages: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
    })),
    conversationId: z.string(),
});

export type SendConversationActionDto = z.infer<typeof SendConversationActionSchema>;
