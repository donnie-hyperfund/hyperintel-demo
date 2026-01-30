import { type NextRequest, NextResponse } from 'next/server';
import { HttpQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { withAuth } from '@/lib/api/auth-guard';
import { createAiVersion } from '@/lib/orm/artifacts/artifact.helpers';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';

const ERRORS = {
    VERSION_NOT_FOUND: NextResponse.json(
        { error: 'Version not found', code: 'VERSION_NOT_FOUND' },
        { status: 404 },
    ),
    INVALID_STATUS: (status: string) =>
        NextResponse.json(
            { error: `Cannot approve version with status '${status}'`, code: 'INVALID_STATUS' },
            { status: 400 },
        ),
};

type RouteParams = { projectId: string; artifactId: string; versionId: string };

async function handleApproveVersion(
    _req: NextRequest,
    { projectId, artifactId, versionId }: RouteParams,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    // Find the version and verify ownership through project
    const version = await em
        .createQueryBuilder(ArtifactVersionEntity, 'v')
        .select('v.*')
        .leftJoinAndSelect('v.artifact', 'a')
        .leftJoin('a.project', 'p')
        .where({
            'v.id': versionId,
            'a.id': artifactId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .getSingleResult();

    if (!version) {
        return ERRORS.VERSION_NOT_FOUND;
    }

    if (version.status !== 'proposed') {
        return ERRORS.INVALID_STATUS(version.status);
    }

    // Approve the version
    version.status = 'approved';
    version.status_changed_at = new Date();
    version.status_changed_by = user.id;

    // Update artifact's current_version
    version.artifact.current_version = version;

    await em.flush();

    // Create AI copy for semantic search
    const aiVersion = await createAiVersion(em, version.artifact, version);

    // Queue embedding job for AI version
    const embeddingWorkerUrl = process.env.EMBEDDING_WORKER_URL;
    const embeddingAuthSecret = process.env.EMBEDDING_AUTH_SECRET;
    if (embeddingWorkerUrl && embeddingAuthSecret) {
        const embeddingQueue = new HttpQueueAdapter(embeddingWorkerUrl, embeddingAuthSecret);
        await embeddingQueue.send({
            type: 'index_artifact_version',
            projectId,
            versionId: aiVersion.versionId,
            content: version.content,
            documentName: version.artifact.key,
        });
    }

    return NextResponse.json({
        success: true,
        version: version.version,
        status: 'approved',
    });
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<RouteParams> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const resolvedParams = await params;
        return await handleApproveVersion(request, resolvedParams, user);
    })(req);
}
