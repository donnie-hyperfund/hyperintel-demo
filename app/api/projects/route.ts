import { createEmbeddingQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { validatePayload } from '@/lib/api/validation';
import { importPublicArtifactsToProject } from '@/lib/artifacts/import';
import { broadcastUserEvent } from '@/lib/broadcast/user-event';
import { handleListProjects } from '@/lib/projects/handlers';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { CreateProjectBodySchema, type ProjectDto } from '@/lib/schema/project';

export function GET(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleListProjects(request, user))(req);
}

async function handleCreateProject(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const body = await req.json();
    const bodyData = validatePayload(CreateProjectBodySchema, body);

    if (bodyData instanceof NextResponse) return bodyData;

    const { name, description } = bodyData;

    const project = em.create(ProjectEntity, {
        name,
        description: description ?? null,
        user,
    });

    await em.persistAndFlush(project);

    // Auto-import public artifacts (e.g. Company Profile) into the new project
    const importResult = await importPublicArtifactsToProject(em, project.id).catch((err) => {
        console.error('[createProject] Failed to import public artifacts:', err);
        return null;
    });

    // Queue embeddings for imported public artifacts
    if (importResult && importResult.imported > 0) {
        const embeddingQueue = createEmbeddingQueueAdapter({
            httpEndpoint: process.env.EMBEDDING_WORKER_URL ? `${process.env.EMBEDDING_WORKER_URL}/enqueue` : undefined,
            authSecret: process.env.AUTH_SECRET,
        });

        const embedPromises = importResult.details
            .filter((d) => d.status === 'imported' && d.newVersionId && d.content)
            .map((d) =>
                embeddingQueue
                    .send({
                        type: 'index_artifact_version',
                        projectId: project.id,
                        versionId: d.newVersionId!,
                        content: d.content!,
                        documentName: d.key,
                        is_ai_content: true,
                    })
                    .catch((err) => console.error(`[createProject] Failed to queue embedding for ${d.key}:`, err)),
            );

        Promise.all(embedPromises).catch(() => {});
    }

    // Broadcast project_created to all user WS connections (fire-and-forget)
    if (user.clerkId) {
        broadcastUserEvent(user.clerkId, 'project_created', { projectId: project.id }).catch(console.error);
    }

    const dto: ProjectDto = wrap(project).toJSON();
    return NextResponse.json(dto, { status: 201 });
}

export function POST(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleCreateProject(request, user))(req);
}
