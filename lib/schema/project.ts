import { z } from 'zod';

export const PROJECT_LIST_STATUSES = ['active', 'archived', 'all'] as const;
export type ProjectListStatus = (typeof PROJECT_LIST_STATUSES)[number];

export const ListProjectsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    status: z.enum(PROJECT_LIST_STATUSES).optional(),
});
export type ListProjectsQueryDto = z.infer<typeof ListProjectsQuerySchema>;

export const CreateProjectBodySchema = z.object({
    name: z.string().trim().min(1, 'Name is required'),
    description: z.string().trim().nullable().optional(),
});
export type CreateProjectBodyDto = z.infer<typeof CreateProjectBodySchema>;

export const UpdateProjectBodySchema = z.object({
    name: z.string().trim().min(1, 'Name cannot be empty').optional(),
    description: z.string().trim().nullable().optional(),
    archived: z.boolean().optional(),
});
export type UpdateProjectBodyDto = z.infer<typeof UpdateProjectBodySchema>;

export const ProjectDtoSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable().optional(),
    current_phase: z.string().nullable().optional(),
    user: z.union([z.string().uuid(), z.object({}).passthrough()]),
    metadata: z.record(z.unknown()).nullable().optional(),
    archived_at: z.union([z.string(), z.date()]).nullable().optional(),
    created_at: z.union([z.string(), z.date()]),
    updated_at: z.union([z.string(), z.date()]),
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

export const ImportArtifactsBodySchema = z.object({
    projectId: z.string().uuid(),
    artifactIds: z.array(z.string().uuid()).min(1, 'At least one artifact is required').max(50),
});
export type ImportArtifactsBodyDto = z.infer<typeof ImportArtifactsBodySchema>;

/** Worker action schema — includes projectId since workers don't use path params */
export const ImportArtifactsActionSchema = ImportArtifactsBodySchema.extend({
    projectId: z.string().uuid(),
});
export type ImportArtifactsActionDto = z.infer<typeof ImportArtifactsActionSchema>;

export const ImportDetailSchema = z.object({
    sourceArtifactId: z.string().uuid(),
    newArtifactId: z.string().uuid().optional(),
    newVersionId: z.string().uuid().optional(),
    key: z.string(),
    status: z.enum(['imported', 'skipped_duplicate', 'error']),
    error: z.string().optional(),
});

export const ImportResultSchema = z.object({
    imported: z.number(),
    skipped: z.number(),
    details: z.array(ImportDetailSchema),
});
export type ImportResultDto = z.infer<typeof ImportResultSchema>;
