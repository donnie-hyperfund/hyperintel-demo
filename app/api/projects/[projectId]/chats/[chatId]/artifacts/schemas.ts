import { z } from 'zod';

export const ListArtifactsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
});
export type ListArtifactsQueryDto = z.infer<typeof ListArtifactsQuerySchema>;

export const ArtifactResponseSchema = z.object({
    id: z.string().uuid(),
    key: z.string(),
    title: z.string(),
    version: z.number().int(),
    chatId: z.string().uuid(),
    projectId: z.string().uuid(),
    currentVersion: z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        content: z.string(),
        createdAt: z.string(),
    }),
    metadata: z.record(z.unknown()).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type ArtifactResponseDto = z.infer<typeof ArtifactResponseSchema>;

