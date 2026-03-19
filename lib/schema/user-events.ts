import { z } from 'zod';

export const UserEventType = {
    ProjectResourceUploadUpdated: 'project_resource_upload_updated',
} as const;

export const ProjectResourceUploadUpdatedPayloadSchema = z.object({
    projectId: z.string().uuid(),
    entryId: z.string().min(1),
    artifactId: z.string().uuid(),
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
    status: z.enum(['uploading', 'processing', 'ready']),
    fileId: z.string().uuid().optional(),
});

export type ProjectResourceUploadUpdatedPayload = z.infer<typeof ProjectResourceUploadUpdatedPayloadSchema>;
