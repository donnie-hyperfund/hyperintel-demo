import z from 'zod';

export const SendChatActionSchema = z.object({
    message: z.string(),
    chatId: z.string().uuid(),
});

export type SendChatActionDto = z.infer<typeof SendChatActionSchema>;
