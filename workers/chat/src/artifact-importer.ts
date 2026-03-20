import { PublicError } from '@common/common/error.helpers';
import { CloudflareQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { importArtifactsToProject } from '@/lib/artifacts/import';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { ImportArtifactsActionDto } from '@/lib/schema/project';
import { UserEventType } from '@/lib/schema/user-events';
import { Ctx } from './context';
import { broadcastUserEvent } from './utils/broadcast';

export async function importArtifactsHandler(
    data: ImportArtifactsActionDto,
    ctx: Ctx,
): Promise<{ imported: number; skipped: number; details: Record<string, unknown>[] }> {
    const { projectId, artifactIds } = data;
    const { em, user } = ctx;

    if (!em) {
        throw new PublicError(500, {
            message: 'Database connection not available',
            code: 'DATABASE_UNAVAILABLE',
        });
    }

    // Verify project ownership via clerkId
    const project = await em.findOne(
        ProjectEntity,
        {
            id: projectId,
            user: { clerkId: user.userId },
        },
        { populate: ['user'] },
    );

    if (!project) {
        throw new PublicError(404, {
            message: 'Project not found',
            code: 'PROJECT_NOT_FOUND',
        });
    }

    // Resolve the user's DB id from the project owner
    const userId = project.user.id;

    const result = await importArtifactsToProject(em, userId, projectId, artifactIds);

    // Queue embeddings for imported artifacts (fire-and-forget)
    if (result.imported > 0 && ctx.env.EMBEDDING_QUEUE) {
        try {
            const embeddingQueue = new CloudflareQueueAdapter(ctx.env.EMBEDDING_QUEUE);

            const embedPromises = result.details
                .filter((d) => d.status === 'imported' && d.newVersionId && d.content)
                .map((d) =>
                    embeddingQueue
                        .send({
                            type: 'index_artifact_version',
                            projectId,
                            versionId: d.newVersionId!,
                            content: d.content!,
                            documentName: d.key,
                            is_ai_content: true,
                        })
                        .catch((err) => console.error(`[import] Failed to queue embedding for ${d.key}:`, err)),
                );

            Promise.all(embedPromises).catch(() => {});
        } catch (err) {
            console.error('[import] Embedding queue setup failed:', err);
        }
    }

    if (result.imported > 0) {
        await broadcastUserEvent(ctx, UserEventType.ProjectResourceImported, { projectId });
    }

    // Strip content from response (not needed by client)
    const responseDetails = result.details.map(({ content: _content, ...rest }) => rest);

    return { ...result, details: responseDetails };
}
