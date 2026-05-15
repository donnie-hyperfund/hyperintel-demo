import { z } from 'zod';

export const UserEventType = {
    ProjectResourceUploadUpdated: 'project_resource_upload_updated',
    ProjectResourceDeleted: 'project_resource_deleted',
    ProjectResourceImported: 'project_resource_imported',
    ArtifactStreamStarted: 'artifact_stream_started',
    ArtifactStreamCompleted: 'artifact_stream_completed',
} as const;

export const ArtifactStreamStartedPayloadSchema = z.object({
    chatId: z.string().uuid(),
    domain: z.enum(['chat', 'intake']),
    chatType: z.enum(['phase', 'company', 'stakeholder']).optional(),
    projectId: z.string().uuid().nullable().optional(),
    projectName: z.string().nullable().optional(),
    phaseName: z.string().nullable().optional(),
    phaseIndex: z.number().int().nullable().optional(),
    artifactId: z.string().uuid(),
    artifactKey: z.string(),
    artifactName: z.string(),
    version: z.number().int(),
    isInternal: z.boolean().optional(),
    mode: z.enum(['create', 'edit', 'replace']).optional(),
    loadedVersion: z.number().int().optional(),
});
export type ArtifactStreamStartedPayload = z.infer<typeof ArtifactStreamStartedPayloadSchema>;

export const ArtifactStreamCompletedPayloadSchema = z.object({
    chatId: z.string().uuid(),
    domain: z.enum(['chat', 'intake']),
    chatType: z.enum(['phase', 'company', 'stakeholder']).optional(),
    projectId: z.string().uuid().nullable().optional(),
    artifactId: z.string().uuid(),
    artifactKey: z.string(),
});
export type ArtifactStreamCompletedPayload = z.infer<typeof ArtifactStreamCompletedPayloadSchema>;

export const ARTIFACT_PROCESSING_STAGES = ['queued', 'saving', 'publishing', 'indexing', 'finalizing'] as const;

export const ArtifactProcessingStageSchema = z.enum(ARTIFACT_PROCESSING_STAGES);
export type ArtifactProcessingStage = z.infer<typeof ArtifactProcessingStageSchema>;

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

export const ProjectResourceDeletedPayloadSchema = z.object({
    projectId: z.string().uuid(),
    artifactId: z.string().uuid(),
});

export type ProjectResourceDeletedPayload = z.infer<typeof ProjectResourceDeletedPayloadSchema>;

export const ProjectResourceImportedPayloadSchema = z.object({
    projectId: z.string().uuid(),
});

export type ProjectResourceImportedPayload = z.infer<typeof ProjectResourceImportedPayloadSchema>;
