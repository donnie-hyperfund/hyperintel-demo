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

export const TokenBreakdownSchema = z.object({
    context: z.number(),
    prompt: z.number(),
    promptTool: z.number(),
    toolDef: z.number(),
});

export type TokenBreakdown = z.infer<typeof TokenBreakdownSchema>;

export const TokenUsageSchema = z.object({
    tokenBreakdown: TokenBreakdownSchema,
    usedTokens: z.number(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;
