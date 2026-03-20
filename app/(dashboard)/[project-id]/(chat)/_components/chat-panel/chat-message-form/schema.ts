import { z } from 'zod';

export const chatMessageFormSchema = z.object({
    message: z.string(),
});

export type ChatMessageFormValues = z.infer<typeof chatMessageFormSchema>;
