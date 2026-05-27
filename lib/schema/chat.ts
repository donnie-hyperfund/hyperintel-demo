import z from 'zod';

export const SendChatActionSchema = z
    .object({
        /** User message content. `null` = nudge (trigger generation on last injected system event). */
        message: z.string().nullable(),
        chatId: z.string().uuid(),
        model: z.string().optional(),
        tempId: z.string().uuid('tempId must be a valid UUID').optional(),
        /** IDs of uploaded image files (ChatMessageFileEntity) to attach to this message. */
        imageFileIds: z.array(z.string().uuid()).max(10).optional(),
        /** User acknowledged the context-warning gate and wants to proceed anyway. */
        bypass_context_warning: z.boolean().optional(),
        /** Trigger a forced completion brief instead of a normal reply (requires message === null). */
        force_brief: z.boolean().optional(),
    })
    .refine((data) => !(data.force_brief === true && data.message !== null), {
        message: 'force_brief may only be true when message is null',
        path: ['force_brief'],
    });

export type SendChatActionDto = z.infer<typeof SendChatActionSchema>;

export const SendChatActionStartedResponseSchema = z.object({
    userMessageId: z.string().uuid().optional(),
    agentMessageId: z.string().uuid(),
});
export type SendChatActionStartedResponseDto = z.infer<typeof SendChatActionStartedResponseSchema>;

export const SendChatActionSkippedResponseSchema = z.object({
    ok: z.literal(true),
    nudge: z.literal('skipped'),
});
export type SendChatActionSkippedResponseDto = z.infer<typeof SendChatActionSkippedResponseSchema>;

export const SendChatActionResponseSchema = z.union([
    SendChatActionStartedResponseSchema,
    SendChatActionSkippedResponseSchema,
]);
export type SendChatActionResponseDto = z.infer<typeof SendChatActionResponseSchema>;

export const AbortActionSchema = z.object({
    chatId: z.string().uuid(),
    agentMessageId: z.string(),
});

export type AbortActionDto = z.infer<typeof AbortActionSchema>;

export const PhaseTransitionActionSchema = z.object({
    chatId: z.string().uuid(),
});

export type PhaseTransitionActionDto = z.infer<typeof PhaseTransitionActionSchema>;

export const PhaseTransitionActionResponseSchema = z.object({
    agentMessageId: z.string().uuid(),
});
export type PhaseTransitionActionResponseDto = z.infer<typeof PhaseTransitionActionResponseSchema>;

export const StartPendingPhaseActionSchema = z.object({
    chatId: z.string().uuid(),
});

export type StartPendingPhaseActionDto = z.infer<typeof StartPendingPhaseActionSchema>;

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
