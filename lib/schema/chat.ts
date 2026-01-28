import z from 'zod';

export const SendChatActionSchema = z.object({
    message: z.string(),
    chatId: z.string().uuid(),
});

export type SendChatActionDto = z.infer<typeof SendChatActionSchema>;

export const SummarizeActionSchema = z.object({
    chatId: z.string().uuid(),
});

export type SummarizeActionDto = z.infer<typeof SummarizeActionSchema>;

export interface TokenUsageBreakdown {
    context: number;
    prompt: number;
    promptTool: number;
    toolDef: number;
}

export interface TokenUsage {
    breakdown: TokenUsageBreakdown;
    total: number;
}
