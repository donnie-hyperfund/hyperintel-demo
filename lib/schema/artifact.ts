import { z } from 'zod';

export const VersionStatusSchema = z.enum(['proposed', 'approved', 'rejected', 'superseded']);
export type VersionStatus = z.infer<typeof VersionStatusSchema>;

export const ListArtifactsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    key: z.string().optional(),
});
export type ListArtifactsQueryDto = z.infer<typeof ListArtifactsQuerySchema>;

export const ArtifactVersionDtoSchema = z.object({
    id: z.string().uuid(),
    version: z.number().int(),
    content: z.string(),
    status: VersionStatusSchema,
    rejection_reason: z.string().nullable().optional(),
    status_changed_at: z.union([z.string(), z.date()]).nullable().optional(),
    status_changed_by: z.string().uuid().nullable().optional(),
    created_at: z.union([z.string(), z.date()]),
    updated_at: z.union([z.string(), z.date()]).nullable().optional(),
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
    proposed_version: ArtifactVersionDtoSchema.optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    created_at: z.union([z.string(), z.date()]),
    updated_at: z.union([z.string(), z.date()]),
});
export type ArtifactDto = z.infer<typeof ArtifactDtoSchema>;

export const ApproveArtifactActionSchema = z.object({
    versionId: z.string().uuid(),
});
export type ApproveArtifactActionDto = z.infer<typeof ApproveArtifactActionSchema>;

export const RejectArtifactActionSchema = z.object({
    versionId: z.string().uuid(),
    reason: z.string().min(1, 'Rejection reason is required'),
});
export type RejectArtifactActionDto = z.infer<typeof RejectArtifactActionSchema>;
