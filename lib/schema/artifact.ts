import { z } from 'zod';

export const ListArtifactsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
});
export type ListArtifactsQueryDto = z.infer<typeof ListArtifactsQuerySchema>;

export const ArtifactVersionDtoSchema = z.object({
    id: z.string().uuid(),
    version: z.number().int(),
    content: z.string(),
    created_at: z.union([z.string(), z.date()]),
});
export type ArtifactVersionDto = z.infer<typeof ArtifactVersionDtoSchema>;

export const ArtifactDtoSchema = z.object({
    id: z.string().uuid(),
    key: z.string(),
    title: z.string(),
    version: z.number().int(),
    chat: z.union([z.string().uuid(), z.object({}).passthrough()]),
    project: z.union([z.string().uuid(), z.object({}).passthrough()]),
    current_version: ArtifactVersionDtoSchema.optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    created_at: z.union([z.string(), z.date()]),
    updated_at: z.union([z.string(), z.date()]),
});
export type ArtifactDto = z.infer<typeof ArtifactDtoSchema>;
