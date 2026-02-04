import { z } from 'zod';
import { VersionStatusSchema } from './artifact';
import { TokenUsageSchema } from './chat';

// ============================================================================
// STREAM BLOCK SCHEMAS (mirrors common/ai/agent/types.ts)
// ============================================================================

const BaseStreamBlockSchema = z.object({
    id: z.string(),
    turnIndex: z.number().optional(),
    offsetMs: z.number().optional(),
    durationMs: z.number().optional(),
});

export const TextStreamBlockSchema = BaseStreamBlockSchema.extend({
    type: z.literal('text'),
    content: z.string(),
    citations: z
        .array(
            z.object({
                url: z.string(),
                title: z.string().optional(),
                cited_text: z.string(),
                start_index: z.number(),
                end_index: z.number(),
                provider: z.enum(['anthropic', 'openai']),
                encrypted_index: z.string().optional(),
            }),
        )
        .optional(),
});

export const ReasoningStreamBlockSchema = BaseStreamBlockSchema.extend({
    type: z.literal('reasoning'),
    content: z.string(),
    source: z.enum(['anthropic', 'openai', 'xai', 'gemini', 'other']).optional(),
    thinkingSignature: z.string().optional(),
    redactedThinkingData: z.string().optional(),
});

export const ToolCallStreamBlockSchema = BaseStreamBlockSchema.extend({
    type: z.literal('tool_call'),
    content: z.string(),
    toolName: z.string(),
    toolInput: z.any(),
    toolCallId: z.string(),
    toolOutput: z.string().optional(),
    toolSuccess: z.boolean().optional(),
    appendedOutput: z.string().optional(),
});

export const SearchStreamBlockSchema = BaseStreamBlockSchema.extend({
    type: z.literal('search'),
    content: z.string(),
    searchQuery: z.string().optional(),
    provider: z.enum(['anthropic', 'openai', 'openrouter']).optional(),
    resultCount: z.number().optional(),
    isComplete: z.boolean().optional(),
    providerData: z
        .object({
            anthropic: z
                .object({
                    serverToolUseId: z.string(),
                    serverToolInput: z.record(z.unknown()),
                    serverToolResults: z.array(
                        z.object({
                            type: z.literal('web_search_result'),
                            url: z.string(),
                            title: z.string(),
                            encrypted_content: z.string(),
                            page_age: z.string().optional(),
                        }),
                    ),
                })
                .optional(),
        })
        .optional(),
    // Deprecated fields for backwards compat
    serverToolUseId: z.string().optional(),
    serverToolInput: z.record(z.unknown()).optional(),
});

export const CitationStreamBlockSchema = BaseStreamBlockSchema.extend({
    type: z.literal('citation'),
    content: z.string(),
    citationUrl: z.string(),
});

export const StreamBlockSchema = z.discriminatedUnion('type', [
    TextStreamBlockSchema,
    ReasoningStreamBlockSchema,
    ToolCallStreamBlockSchema,
    SearchStreamBlockSchema,
    CitationStreamBlockSchema,
]);

export type StreamBlockDto = z.infer<typeof StreamBlockSchema>;

// ============================================================================
// CHAT SCHEMAS
// ============================================================================

export const ListChatsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
});
export type ListChatsQueryDto = z.infer<typeof ListChatsQuerySchema>;

/** Lightweight document summary for chat response - includes version metadata */
export const ChatDocumentSummaryDtoSchema = z.object({
    id: z.string().uuid(),
    key: z.string(),
    title: z.string(),
    /** Version number of current approved version, null if none approved yet */
    current_version: z.number().int().nullable(),
    /** Highest version number that exists */
    newest_version: z.number().int(),
    /** Status of the newest version (proposed = pending changes) */
    status: VersionStatusSchema,
    created_at: z.union([z.string(), z.date()]),
    updated_at: z.union([z.string(), z.date()]),
});
export type ChatDocumentSummaryDto = z.infer<typeof ChatDocumentSummaryDtoSchema>;

export const CreateChatBodySchema = z.object({
    title: z.string().trim().optional(),
});
export type CreateChatBodyDto = z.infer<typeof CreateChatBodySchema>;

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
    /** Synthetic array of documents with version metadata */
    documents: z.array(ChatDocumentSummaryDtoSchema).optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    token_usage: TokenUsageSchema.nullable().optional(),
    /** Whether the chat has any pending document changes awaiting approval */
    has_pending_changes: z.boolean().optional(),
    created_at: z.union([z.string(), z.date()]),
    updated_at: z.union([z.string(), z.date()]),
});
export type ChatDto = z.infer<typeof ChatDtoSchema>;

export const ChatMessageDtoSchema = z.object({
    id: z.string().uuid(),
    role: z.string(),
    content: z.string(),
    reasoning: z.string().nullable().optional(),
    blocks: z.array(StreamBlockSchema).nullable().optional(),
    chat: z.union([z.string().uuid(), z.object({}).passthrough()]),
    metadata: z.record(z.unknown()).nullable().optional(),
    created_at: z.union([z.string(), z.date()]),
});
export type ChatMessageDto = z.infer<typeof ChatMessageDtoSchema>;
