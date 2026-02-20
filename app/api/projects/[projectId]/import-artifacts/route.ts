import { type NextRequest, NextResponse } from 'next/server';
import { createEmbeddingQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { withAuth } from '@/lib/api/auth-guard';
import { validatePayload } from '@/lib/api/validation';
import { importArtifactsToProject } from '@/lib/artifacts/import';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { ImportArtifactsBodySchema } from '@/lib/schema/project';

async function handleImport(
    req: NextRequest,
    projectId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const body = await req.json();
    const bodyData = validatePayload(ImportArtifactsBodySchema, body);
    if (bodyData instanceof NextResponse) return bodyData;

    // Verify project ownership
    const project = await em.findOne(ProjectEntity, { id: projectId, user: user.id });
    if (!project) {
        return NextResponse.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, { status: 404 });
    }

    // Import artifacts
    const result = await importArtifactsToProject(em, user.id, projectId, bodyData.artifactIds);

    // Queue embeddings for imported artifacts (fire-and-forget)
    if (result.imported > 0) {
        const embeddingQueue = createEmbeddingQueueAdapter({
            httpEndpoint: process.env.EMBEDDING_WORKER_URL
                ? `${process.env.EMBEDDING_WORKER_URL}/enqueue`
                : undefined,
            authSecret: process.env.AUTH_SECRET,
        });

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

        // Don't block response on embedding
        Promise.all(embedPromises).catch(() => {});
    }

    // Strip content from response (not needed by client)
    const responseDetails = result.details.map(({ content: _content, ...rest }) => rest);

    return NextResponse.json({ ...result, details: responseDetails });
}

export function POST(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return handleImport(request, projectId, user);
    })(req);
}
