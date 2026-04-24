import { z } from 'zod';
import { z as z4 } from 'zod/v4';
import { zfd } from 'zod-form-data';

// TODO use enum-util
export const VERSION_STATUSES = ['proposed', 'approved', 'rejected', 'superseded', 'deleted'] as const;
export const VersionStatusSchema = z.enum(VERSION_STATUSES);
export type VersionStatus = z.infer<typeof VersionStatusSchema>;

/** Terminal/dead-end statuses. The latest version can only be restored when it has one of these. */
export const TERMINAL_VERSION_STATUSES: readonly VersionStatus[] = ['rejected', 'superseded', 'deleted'] as const;

export const INTERNAL_DOCUMENTS = [
    'Genesis DNA',
    'Legacy DNA',
    'Team Specification',
    'MID',
    'PSEB',
    'Action Plan',
    'Completion Brief',
    'Company Profile',
    'Human Persona',
] as const;

export const DOCUMENT_TYPES = [
    ...INTERNAL_DOCUMENTS,
    // 'Analysis',
    'Research Report',
    'Executive Summary',
    'PECP',
    'Other',
] as const;
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

/**
 * Estimated character counts per document type, derived from production data.
 * Used for approximate progress tracking during document generation streaming.
 * Values represent average content length in characters.
 */
export const DOCUMENT_CHAR_ESTIMATES: Record<DocumentType, number> = {
    'Genesis DNA': 16000,
    'Legacy DNA': 28000,
    'Team Specification': 18000,
    MID: 26000,
    PSEB: 13000,
    'Action Plan': 20000,
    'Completion Brief': 20000,
    'Company Profile': 15000,
    'Human Persona': 8000,
    'Research Report': 14000,
    'Executive Summary': 10000,
    PECP: 4000,
    Other: 14000,
};

/** Document types that should be published to user scope on approval */
export const PUBLISHABLE_DOCUMENT_TYPES: readonly DocumentType[] = ['Legacy DNA'] as const;

/** Document types that are treated as project resources (not deliverables) when imported */
export const RESOURCE_DOCUMENT_TYPES: readonly DocumentType[] = [
    'Legacy DNA',
    'Company Profile',
    'Human Persona',
] as const;

/** Document types visible and importable across all users (not restricted to owner) */
export const SHARED_DOCUMENT_TYPES: readonly DocumentType[] = ['Company Profile', 'Human Persona'] as const;

export const FILTERABLE_STATUSES = ['proposed', 'approved', 'rejected', 'superseded'] as const;
export const FilterableStatusSchema = z.enum(FILTERABLE_STATUSES);
export type FilterableStatus = z.infer<typeof FilterableStatusSchema>;

export const VisibilityFilterSchema = z.enum(['client', 'internal']);
export type VisibilityFilter = z.infer<typeof VisibilityFilterSchema>;

export const OWNERSHIP_FILTERS = ['mine', 'shared'] as const;
export const OwnershipFilterSchema = z.enum(OWNERSHIP_FILTERS);
export type OwnershipFilter = z.infer<typeof OwnershipFilterSchema>;

const csvOf = <T extends z.ZodTypeAny>(schema: T) =>
    z
        .string()
        .transform((s) => s.split(',').filter(Boolean))
        .pipe(z.array(schema));

export const ListArtifactsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    key: z.string().optional(),
    version: z.coerce.number().int().positive().optional(),
    visibility: csvOf(VisibilityFilterSchema).optional(),
    status: csvOf(FilterableStatusSchema).optional(),
    chatId: csvOf(z.string().uuid()).optional(),
    document_type: DocumentTypeSchema.optional(),
    search: z.string().max(200).optional(),
    ownership: OwnershipFilterSchema.optional(),
});
export type ListArtifactsQueryDto = z.infer<typeof ListArtifactsQuerySchema>;

export const GetArtifactQuerySchema = z.object({
    version: z.coerce.number().int().positive().optional(),
});
export type GetArtifactQueryDto = z.infer<typeof GetArtifactQuerySchema>;

export const ListArtifactVersionsQuerySchema = z.object({
    key: z.string().min(1),
});
export type ListArtifactVersionsQueryDto = z.infer<typeof ListArtifactVersionsQuerySchema>;

export const ArtifactVersionDtoSchema = z.object({
    id: z.string().uuid(),
    chat: z
        .union([z.string().uuid(), z.object({}).passthrough()])
        .nullable()
        .optional(),
    version: z.number().int(),
    title: z.string(),
    content: z.string(),
    status: VersionStatusSchema,
    is_uploaded: z.boolean().optional(),
    rejection_reason: z.string().nullable().optional(),
    status_changed_at: z.union([z.string(), z.date()]).nullable().optional(),
    status_changed_by: z.string().uuid().nullable().optional(),
    is_internal: z.boolean().optional(),
    document_type: DocumentTypeSchema.optional(),
    created_at: z.union([z.string(), z.date()]),
    updated_at: z.union([z.string(), z.date()]).nullable().optional(),
});
export type ArtifactVersionDto = z.infer<typeof ArtifactVersionDtoSchema>;

export const ArtifactDtoSchema = z.object({
    id: z.string().uuid(),
    key: z.string(),
    version: z.number().int(),
    project: z
        .union([z.string().uuid(), z.object({}).passthrough()])
        .nullable()
        .optional(),
    user: z
        .union([z.string().uuid(), z.object({}).passthrough()])
        .nullable()
        .optional(),
    is_public: z.boolean().optional(),
    /** Whether this artifact belongs to the current authenticated user */
    is_own: z.boolean().optional(),
    current_version: ArtifactVersionDtoSchema.optional(),
    proposed_version: ArtifactVersionDtoSchema.optional(),
    loaded_version: ArtifactVersionDtoSchema.optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
    /** PECP (public summary) for internal documents */
    pecp: z
        .object({
            id: z.string().uuid(),
            content: z.string(),
            version: z.number().int(),
            created_at: z.union([z.string(), z.date()]),
        })
        .nullable()
        .optional(),
    created_at: z.union([z.string(), z.date()]),
    updated_at: z.union([z.string(), z.date()]),
});
export type ArtifactDto = z.infer<typeof ArtifactDtoSchema>;

export const ArtifactVersionHistoryResponseSchema = z.object({
    artifact: z.object({
        id: z.string().uuid(),
        key: z.string(),
        title: z.string(),
        latestVersion: z.number().int().positive(),
        currentVersion: z.number().int().nullable(),
    }),
    versions: z.array(ArtifactVersionDtoSchema),
});
export type ArtifactVersionHistoryResponseDto = z.infer<typeof ArtifactVersionHistoryResponseSchema>;

export const ApproveArtifactActionSchema = z.object({
    versionId: z.string().uuid(),
});
export type ApproveArtifactActionDto = z.infer<typeof ApproveArtifactActionSchema>;

export const RejectArtifactActionSchema = z.object({
    versionId: z.string().uuid(),
    reason: z.string().min(1, 'Rejection reason is required'),
});
export type RejectArtifactActionDto = z.infer<typeof RejectArtifactActionSchema>;

export const RestoreArtifactActionSchema = z.object({
    projectId: z.string().uuid().optional(),
    key: z.string().min(1),
    sourceVersionId: z.string().uuid(),
});
export type RestoreArtifactActionDto = z.infer<typeof RestoreArtifactActionSchema>;

export const RestoreArtifactResponseSchema = z.object({
    success: z.literal(true),
    artifactId: z.string().uuid(),
    key: z.string(),
    sourceVersion: z.number().int().positive(),
    restoredVersion: z.number().int().positive(),
    restoredVersionId: z.string().uuid(),
    status: z.literal('proposed'),
    supersededVersions: z.array(z.number().int().positive()),
    chatId: z.string().uuid().optional(),
    chatType: z.string().optional(),
});
export type RestoreArtifactResponseDto = z.infer<typeof RestoreArtifactResponseSchema>;

export const MAX_ARTIFACT_UPLOAD_SIZE = 50 * 1024 * 1024;

export const TEXT_ARTIFACT_EXTENSIONS = ['.md', '.txt', '.rtf'] as const;
export const BINARY_ARTIFACT_EXTENSIONS = ['.pdf', '.docx', '.pptx'] as const;
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'] as const;
export const ALLOWED_ARTIFACT_EXTENSIONS = [
    ...TEXT_ARTIFACT_EXTENSIONS,
    ...BINARY_ARTIFACT_EXTENSIONS,
    ...IMAGE_EXTENSIONS,
] as string[];

export const IMAGE_MIME_TYPES: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

export function isImageExtension(ext: string): boolean {
    return (IMAGE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** Infer MIME type from a filename or R2 key. Defaults to `image/png`. */
export function inferImageMimeType(key: string): ImageMimeType {
    const dot = key.lastIndexOf('.');
    if (dot === -1) return 'image/png';
    return (IMAGE_MIME_TYPES[key.slice(dot).toLowerCase()] as ImageMimeType) ?? 'image/png';
}

export function isBinaryArtifactExtension(ext: string): boolean {
    return (BINARY_ARTIFACT_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export function isTextArtifactExtension(ext: string): boolean {
    return (TEXT_ARTIFACT_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export const UploadArtifactSchema = zfd.formData({
    file: zfd.file(
        z4.instanceof(File).refine(
            (f) => f.size <= MAX_ARTIFACT_UPLOAD_SIZE,
            // TODO proper formatting
            `File too large (max ${MAX_ARTIFACT_UPLOAD_SIZE / 1024 / 1024}MB)`,
        ),
    ),
    projectId: zfd.text(z4.string().uuid().optional()),
    chatId: zfd.text(z4.string().uuid().optional()),
    title: zfd.text(z4.string().min(1).optional()),
    clientEntryId: zfd.text(z4.string().min(1).optional()),
    source: zfd.text(z4.enum(['chat-input', 'project-resources']).optional()),
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

export const PresignUploadSchema = z.object({
    filename: z.string().min(1),
    fileSize: z.number().int().positive().max(MAX_ARTIFACT_UPLOAD_SIZE),
    projectId: z.string().uuid().optional(),
    chatId: z.string().uuid().optional(),
    title: z.string().min(1).optional(),
    clientEntryId: z.string().min(1).optional(),
    source: z.enum(['chat-input', 'project-resources']).optional(),
});
export type PresignUploadDto = z.infer<typeof PresignUploadSchema>;

export const PresignUploadResponseSchema = z.object({
    uploadUrl: z.string().url(),
    storageKey: z.string(),
    artifactId: z.string().uuid(),
    versionId: z.string().uuid(),
    fileId: z.string().uuid(),
    key: z.string(),
});
export type PresignUploadResponseDto = z.infer<typeof PresignUploadResponseSchema>;

export const ConfirmUploadSchema = z.object({
    fileId: z.string().uuid(),
    versionId: z.string().uuid(),
    clientEntryId: z.string().min(1).optional(),
    source: z.enum(['chat-input', 'project-resources']).optional(),
});
export type ConfirmUploadDto = z.infer<typeof ConfirmUploadSchema>;

export const ConfirmUploadResponseSchema = z.object({
    success: z.boolean(),
    action: z.enum(['created', 'new_version']),
    artifactId: z.string().uuid(),
    versionId: z.string().uuid(),
    version: z.number().int().positive(),
    key: z.string(),
    supersededVersion: z.number().int().positive().optional(),
});
export type ConfirmUploadResponseDto = z.infer<typeof ConfirmUploadResponseSchema>;

export const AssociateUploadsSchema = z
    .object({
        artifactIds: z.array(z.string().uuid()).max(50).optional(),
        imageFileIds: z.array(z.string().uuid()).max(50).optional(),
        chatId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
    })
    .refine((d) => (d.artifactIds?.length ?? 0) > 0 || (d.imageFileIds?.length ?? 0) > 0, {
        message: 'At least one of artifactIds or imageFileIds is required',
    });
export type AssociateUploadsDto = z.infer<typeof AssociateUploadsSchema>;

export const ClearDraftsSchema = z.object({
    artifactIds: z.array(z.string().uuid()).min(1).max(50),
});
export type ClearDraftsDto = z.infer<typeof ClearDraftsSchema>;

export const EXPORT_FORMATS = ['docx'] as const;
export const ExportFormatSchema = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ListUserResourcesQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
    documentType: csvOf(DocumentTypeSchema).optional(),
    /** When true, only return resources whose current_version is approved */
    approvedOnly: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
    /** Exclude resources originally published from this project */
    excludeProjectId: z.string().uuid().optional(),
    search: z.string().max(200).optional(),
    ownership: OwnershipFilterSchema.optional(),
});
export type ListUserResourcesQueryDto = z.infer<typeof ListUserResourcesQuerySchema>;

export const DeleteArtifactSchema = z.object({
    artifactId: z.string().uuid(),
});
export type DeleteArtifactDto = z.infer<typeof DeleteArtifactSchema>;

export const ExportArtifactQuerySchema = z.object({
    artifactVersionId: z.string().uuid(),
    format: ExportFormatSchema.default('docx'),
});
export type ExportArtifactQueryDto = z.infer<typeof ExportArtifactQuerySchema>;
