import { wrap } from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/knex';
import { type NextRequest, NextResponse } from 'next/server';
import { createEmbeddingQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { importArtifactsToProject } from '@/lib/artifacts/import';
import { loadVersionsForArtifacts } from '@/lib/artifacts/queries';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { handleListChatArtifacts } from '@/lib/chats/handlers';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { GetArtifactQuerySchema, ListArtifactsQuerySchema } from '@/lib/schema/artifact';
import { ImportArtifactsBodySchema } from '@/lib/schema/project';

/**
 * List project-scoped artifacts (paginated). Supports `?key=` for single lookup.
 */
export async function handleListProjectArtifacts(
    req: NextRequest,
    projectId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListArtifactsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        key: searchParams.get('key') ?? undefined,
        version: searchParams.get('version') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    // Single artifact by key
    if (queryData.key) {
        const normalizedKey = normalizeArtifactKey(queryData.key);
        const artifact = await em
            .createQueryBuilder(ArtifactEntity, 'a')
            .select('a.*')
            .leftJoin('a.project', 'p')
            .leftJoinAndSelect('a.current_version', 'cv')
            .where({
                'a.key': normalizedKey,
                'p.id': projectId,
                'p.user': user.id,
                $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }],
            })
            .getSingleResult();

        if (!artifact) {
            return NextResponse.json({ error: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 });
        }

        if (queryData.version !== undefined) {
            const requestedVersion = await em.findOne(ArtifactVersionEntity, {
                artifact: artifact.id,
                version: queryData.version,
            });
            if (!requestedVersion) {
                return NextResponse.json({ error: 'Version not found', code: 'VERSION_NOT_FOUND' }, { status: 404 });
            }

            const previousVersion =
                queryData.version > 1
                    ? await em.findOne(ArtifactVersionEntity, {
                          artifact: artifact.id,
                          version: queryData.version - 1,
                      })
                    : null;

            return NextResponse.json({
                ...wrap(artifact).toJSON(),
                current_version: previousVersion ? wrap(previousVersion).toJSON() : undefined,
                proposed_version: wrap(requestedVersion).toJSON(),
            });
        }

        const proposedVersion = await em.findOne(ArtifactVersionEntity, {
            artifact: artifact.id,
            status: 'proposed',
        });

        return NextResponse.json({
            ...wrap(artifact).toJSON(),
            proposed_version: proposedVersion ? wrap(proposedVersion).toJSON() : undefined,
        });
    }

    // Paginated list
    const query = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.project', 'p')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({
            'p.id': projectId,
            'p.user': user.id,
            $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }],
        })
        .orderBy({ 'a.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(query, {
        page: queryData.page ?? 1,
        perPage: queryData.limit ?? 20,
    });

    const artifactIds = nodes.map((a: ArtifactEntity) => a.id);
    const proposedByArtifact = await loadVersionsForArtifacts(em, artifactIds, 'proposed');

    const mappedNodes = nodes.map((artifact: ArtifactEntity) => {
        const proposed = proposedByArtifact.get(artifact.id);
        return {
            ...wrap(artifact).toJSON(),
            proposed_version: proposed ? wrap(proposed).toJSON() : undefined,
        };
    });

    return NextResponse.json(
        createPaginatedResponse(mappedNodes, totalCount, queryData.page ?? 1, queryData.limit ?? 20),
    );
}

export async function handleGetArtifacts(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const chatId = searchParams.get('chatId');

    if (chatId) {
        return handleListChatArtifacts(req, chatId, user);
    }

    if (projectId) {
        return handleListProjectArtifacts(req, projectId, user);
    }

    return handleIntakeArtifacts(req, user);
}

export async function handleIntakeArtifacts(_req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const artifacts = await em.find(
        ArtifactEntity,
        { user: user.id, project: null },
        { orderBy: { created_at: 'DESC' } },
    );

    const artifactIds = artifacts.map((a) => a.id);
    const latestByArtifact = await loadVersionsForArtifacts(em, artifactIds);

    const mapped = artifacts.map((artifact) => {
        const latest = latestByArtifact.get(artifact.id);
        return {
            ...wrap(artifact).toJSON(),
            proposed_version: latest ? wrap(latest).toJSON() : undefined,
        };
    });

    return NextResponse.json(mapped);
}

const ARTIFACT_ERRORS = {
    NOT_FOUND: () =>
        NextResponse.json({ message: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 }),
    VERSION_NOT_FOUND: () =>
        NextResponse.json({ message: 'Version not found', code: 'VERSION_NOT_FOUND' }, { status: 404 }),
    ALREADY_DELETED: () =>
        NextResponse.json({ message: 'Artifact is already deleted', code: 'ALREADY_DELETED' }, { status: 400 }),
    NOT_UPLOADED: () =>
        NextResponse.json(
            { message: 'Only uploaded artifacts can be deleted', code: 'NOT_UPLOADED_ARTIFACT' },
            { status: 403 },
        ),
} as const;

function findArtifactForOwner(
    em: SqlEntityManager,
    artifactId: string,
    ownerUserId: string,
): Promise<ArtifactEntity | null> {
    return em
        .createQueryBuilder(ArtifactEntity, 'artifact')
        .select('artifact.*')
        .leftJoinAndSelect('artifact.current_version', 'currentVersion')
        .leftJoin('artifact.project', 'project')
        .where({
            'artifact.id': artifactId,
            $or: [{ 'project.user': ownerUserId }, { 'artifact.user': ownerUserId }],
        })
        .getSingleResult();
}

export async function handleGetArtifact(req: NextRequest, artifactId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();
    const query = GetArtifactQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const artifact = await findArtifactForOwner(em, artifactId, user.id);
    if (!artifact) return ARTIFACT_ERRORS.NOT_FOUND();

    const [proposedVersion, requestedVersion] = await Promise.all([
        em.findOne(ArtifactVersionEntity, { artifact: artifact.id, status: 'proposed' }),
        query.version !== undefined
            ? em.findOne(ArtifactVersionEntity, { artifact: artifact.id, version: query.version })
            : null,
    ]);

    if (query.version !== undefined && !requestedVersion) return ARTIFACT_ERRORS.VERSION_NOT_FOUND();

    return NextResponse.json({
        ...wrap(artifact).toJSON(),
        proposed_version: proposedVersion ? wrap(proposedVersion).toJSON() : undefined,
        loaded_version: requestedVersion ? wrap(requestedVersion).toJSON() : undefined,
    });
}

export async function handleDeleteArtifact(artifactId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const artifact = await findArtifactForOwner(em, artifactId, user.id);
    if (!artifact) return ARTIFACT_ERRORS.NOT_FOUND();

    const targetVersion =
        artifact.current_version ??
        (await em.findOne(ArtifactVersionEntity, { artifact: artifact.id }, { orderBy: { version: 'DESC' } }));

    if (!targetVersion) return ARTIFACT_ERRORS.NOT_FOUND();
    if (targetVersion.status === 'deleted') return ARTIFACT_ERRORS.ALREADY_DELETED();
    if (!targetVersion.is_uploaded) return ARTIFACT_ERRORS.NOT_UPLOADED();

    targetVersion.status = 'deleted';
    targetVersion.status_changed_at = new Date();
    targetVersion.status_changed_by = user.id;

    if (!artifact.current_version) {
        artifact.current_version = targetVersion;
    }

    await em.flush();

    return NextResponse.json({ success: true, message: 'Artifact deleted' });
}

export async function handleImportArtifacts(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const body = await req.json();
    const bodyData = validatePayload(ImportArtifactsBodySchema, body);
    if (bodyData instanceof NextResponse) return bodyData;

    const { projectId, artifactIds } = bodyData;

    // Verify project ownership
    const project = await em.findOne(ProjectEntity, { id: projectId, user: user.id });
    if (!project) {
        return NextResponse.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, { status: 404 });
    }

    // Import artifacts
    const result = await importArtifactsToProject(em, user.id, projectId, artifactIds);

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

        Promise.all(embedPromises).catch(() => {});
    }

    // Strip content from response
    const responseDetails = result.details.map(({ content: _content, ...rest }) => rest);

    return NextResponse.json({ ...result, details: responseDetails });
}
