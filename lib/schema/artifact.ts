import { z } from 'zod';
import { z as z4 } from 'zod/v4';
import { zfd } from 'zod-form-data';

export const VERSION_STATUSES = ['proposed', 'approved', 'rejected', 'superseded', 'deleted'] as const;
export const VersionStatusSchema = z.enum(VERSION_STATUSES);
export type VersionStatus = z.infer<typeof VersionStatusSchema>;

export const ListArtifactsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    key: z.string().optional(),
    version: z.coerce.number().int().positive().optional(),
});
export type ListArtifactsQueryDto = z.infer<typeof ListArtifactsQuerySchema>;

export const GetArtifactQuerySchema = z.object({
    version: z.coerce.number().int().positive().optional(),
});
export type GetArtifactQueryDto = z.infer<typeof GetArtifactQuerySchema>;

export const ArtifactVersionDtoSchema = z.object({
    id: z.string().uuid(),
    chat: z.union([z.string().uuid(), z.object({}).passthrough()]).nullable().optional(),
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
    project: z.union([z.string().uuid(), z.object({}).passthrough()]).nullable().optional(),
    user: z.union([z.string().uuid(), z.object({}).passthrough()]).nullable().optional(),
    current_version: ArtifactVersionDtoSchema.optional(),
    proposed_version: ArtifactVersionDtoSchema.optional(),
    loaded_version: ArtifactVersionDtoSchema.optional(),
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

export const MAX_ARTIFACT_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB
// TODO: Add '.docx' once we have conversion (e.g. mammoth)
export const ALLOWED_ARTIFACT_EXTENSIONS = ['.md'];

export const UploadArtifactSchema = zfd.formData({
    file: zfd.file(
        z4.instanceof(File).refine(
            (f) => f.size <= MAX_ARTIFACT_UPLOAD_SIZE,
            // TODO proper formatting
            `File too large (max ${MAX_ARTIFACT_UPLOAD_SIZE / 1024 / 1024}MB)`,
        ),
    ),
    projectId: zfd.text(z4.string().uuid()),
    chatId: zfd.text(z4.string().uuid().optional()),
    title: zfd.text(z4.string().min(1).optional()),
});
export type UploadArtifactDto = z4.infer<typeof UploadArtifactSchema>;

export const UploadArtifactResponseSchema = z.object({
    success: z.boolean(),
    action: z.enum(['created', 'new_version']),
    artifactId: z.string().uuid(),
    versionId: z.string().uuid(),
    version: z.number().int().positive(),
    key: z.string(),
    supersededVersion: z.number().int().positive().optional(),
});
export type UploadArtifactResponseDto = z.infer<typeof UploadArtifactResponseSchema>;
