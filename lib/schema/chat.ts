import z from 'zod';

export const SendChatActionSchema = z.object({
    /** User message content. `null` = nudge (trigger generation on last injected system event). */
    message: z.string().nullable(),
    chatId: z.string().uuid(),
    model: z.string().optional(),
    tempId: z.string().uuid('tempId must be a valid UUID').optional(),
    /** IDs of uploaded image files (ChatMessageFileEntity) to attach to this message. */
    imageFileIds: z.array(z.string().uuid()).max(10).optional(),
});

export type SendChatActionDto = z.infer<typeof SendChatActionSchema>;

export const AbortActionSchema = z.object({
    chatId: z.string().uuid(),
    agentMessageId: z.string(),
});

export type AbortActionDto = z.infer<typeof AbortActionSchema>;

export const SummarizeActionSchema = z.object({
    chatId: z.string().uuid(),
});

export type SummarizeActionDto = z.infer<typeof SummarizeActionSchema>;

export const UpdateChatModelSchema = z.object({
    chatId: z.string().uuid(),
    model: z.string(),
});
export type UpdateChatModelDto = z.infer<typeof UpdateChatModelSchema>;

export const UpdateChatNameSchema = z.object({
    name: z.string().trim().min(1).max(100),
});
export type UpdateChatNameDto = z.infer<typeof UpdateChatNameSchema>;

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

// ============================================================================
// INTAKE SCHEMAS (Phase 2 — Company Profile / Human Persona flows)
// ============================================================================

export const INTAKE_FRAMEWORKS = ['cpf', 'hpf'] as const;
export type IntakeFramework = (typeof INTAKE_FRAMEWORKS)[number];

export const PERSONA_CATEGORIES = ['principal', 'champion', 'collaborator'] as const;
export type PersonaCategory = (typeof PERSONA_CATEGORIES)[number];

export const CreateIntakeChatBodySchema = z.object({
    framework: z.enum(INTAKE_FRAMEWORKS),
    category: z.enum(PERSONA_CATEGORIES).optional(),
});

export type CreateIntakeChatBodyDto = z.infer<typeof CreateIntakeChatBodySchema>;

/** Intake uses the same wire format as PMA chat */
export const SendIntakeChatActionSchema = SendChatActionSchema;
export type SendIntakeChatActionDto = SendChatActionDto;

// ============================================================================
// UNIFIED CHAT CREATE (supports both project and intake chats)
// ============================================================================

export const CreateUnifiedChatBodySchema = z.object({
    /** For project chats — associates with an existing project */
    projectId: z.string().uuid().optional(),
    /** For intake chats — selects the intake framework */
    framework: z.enum(INTAKE_FRAMEWORKS).optional(),
    /** For HPF intake — persona category */
    category: z.enum(PERSONA_CATEGORIES).optional(),
    title: z.string().trim().optional(),
});

export type CreateUnifiedChatBodyDto = z.infer<typeof CreateUnifiedChatBodySchema>;
