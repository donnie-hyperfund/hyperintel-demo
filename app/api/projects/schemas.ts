import { z } from 'zod';

export const ListProjectsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
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
});
export type UpdateProjectBodyDto = z.infer<typeof UpdateProjectBodySchema>;

export const ProjectResponseSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    userId: z.string().uuid(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type ProjectResponseDto = z.infer<typeof ProjectResponseSchema>;
