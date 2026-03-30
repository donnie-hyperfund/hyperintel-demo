import { createEmbeddingQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { raw, wrap } from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/knex';
import { type NextRequest, NextResponse } from 'next/server';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { importArtifactsToProject } from '@/lib/artifacts/import';
import { loadVersionsForArtifacts } from '@/lib/artifacts/queries';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { broadcastUserEvent } from '@/lib/broadcast/user-event';
import { handleListChatArtifacts } from '@/lib/chats/handlers';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import {
    GetArtifactQuerySchema,
    ListArtifactsQuerySchema,
    ListArtifactVersionsQuerySchema,
    ListUserResourcesQuerySchema,
} from '@/lib/schema/artifact';
import { ImportArtifactsBodySchema } from '@/lib/schema/project';
import { UserEventType } from '@/lib/schema/user-events';

// ---------------------------------------------------------------------------
// Version history handlers
// ---------------------------------------------------------------------------

export async function handleGetVersions(req: NextRequest, projectId: string, userId: string): Promise<NextResponse> {
    const { em } = await getOrm();

    const queryData = validatePayload(ListArtifactVersionsQuerySchema, {
        key: req.nextUrl.searchParams.get('key') ?? undefined,
    });
    if (queryData instanceof NextResponse) return queryData;

    const key = normalizeArtifactKey(queryData.key);

    const artifact = await em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.project', 'p')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({
            'a.key': key,
            'p.id': projectId,
            'p.user': userId,
        })
        .getSingleResult();

    if (!artifact) {
        return NextResponse.json({ error: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 });
    }

    const versions = await em.find(ArtifactVersionEntity, { artifact: artifact.id }, { orderBy: { version: 'DESC' } });

    return NextResponse.json({
        artifact: {
            id: artifact.id,
            key: artifact.key,
            title: artifact.title,
            latestVersion: artifact.version,
            currentVersion: artifact.current_version?.version ?? null,
        },
        versions: versions.map((v) => wrap(v).toJSON()),
    });
}

/** Version history for user-scoped (intake) artifacts — no project context. */
export async function handleGetUserVersions(req: NextRequest, userId: string): Promise<NextResponse> {
    const { em } = await getOrm();

    const queryData = validatePayload(ListArtifactVersionsQuerySchema, {
        key: req.nextUrl.searchParams.get('key') ?? undefined,
    });
    if (queryData instanceof NextResponse) return queryData;

    const key = normalizeArtifactKey(queryData.key);

    const artifact = await em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({
            'a.key': key,
            'a.user': userId,
            'a.project': null,
        })
        .getSingleResult();

    if (!artifact) {
        return NextResponse.json({ error: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 });
    }

    const versions = await em.find(ArtifactVersionEntity, { artifact: artifact.id }, { orderBy: { version: 'DESC' } });

    return NextResponse.json({
        artifact: {
            id: artifact.id,
            key: artifact.key,
            title: artifact.title,
            latestVersion: artifact.version,
            currentVersion: artifact.current_version?.version ?? null,
        },
        versions: versions.map((v) => wrap(v).toJSON()),
    });
}

// ---------------------------------------------------------------------------
// Project artifact handlers
// ---------------------------------------------------------------------------

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
        visibility: searchParams.get('visibility') ?? undefined,
        status: searchParams.get('status') ?? undefined,
        chatId: searchParams.get('chatId') ?? undefined,
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
        .leftJoin('a.versions', 'pv', { 'pv.status': 'proposed' })
        .where({
            'p.id': projectId,
            'p.user': user.id,
            $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }],
        });

    // Exclude imported resources and uploaded files (they are shown via the project resources endpoint)
    query.andWhere({
        $or: [{ [raw("a.metadata->>'importedFrom'")]: null }, { [raw('a.metadata')]: null }],
    });
    query.andWhere({ $or: [{ 'cv.is_uploaded': null }, { 'cv.is_uploaded': false }] });

    // Apply user-selected filters (prefer proposed version, fall back to current)
    if (queryData.visibility?.length) {
        const booleans = queryData.visibility.map((v) => v === 'internal');
        query.andWhere({
            [raw('COALESCE(pv.is_internal, cv.is_internal)')]: { $in: booleans },
        });
    }

    if (queryData.status?.length) {
        query.andWhere({
            [raw('COALESCE(pv.status, cv.status)')]: { $in: queryData.status },
        });
    }

    if (queryData.chatId?.length) {
        query.andWhere({
            [raw('COALESCE(pv.chat_id, cv.chat_id)')]: { $in: queryData.chatId },
        });
    }

    query.groupBy(['a.id', 'cv.id']).orderBy({ 'a.created_at': 'DESC' });

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

// ---------------------------------------------------------------------------
// Unified artifact router
// ---------------------------------------------------------------------------

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

export async function handleIntakeArtifacts(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();
    const { searchParams } = new URL(req.url);

    const queryData = validatePayload(ListArtifactsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        document_type: searchParams.get('document_type') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const SHARED_DOCUMENT_TYPES: string[] = ['Company Profile', 'Human Persona'];
    const isSharedType = queryData.document_type && SHARED_DOCUMENT_TYPES.includes(queryData.document_type);

    const query = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({
            'a.project': null,
            $or: isSharedType
                ? [
                      // Own artifacts — any status
                      { 'a.user': user.id },
                      // Other users' artifacts — only approved
                      { 'a.user': { $ne: user.id }, 'cv.status': 'approved' },
                  ]
                : [{ 'a.user': user.id }],
        })
        .orderBy({ 'a.created_at': 'DESC' });

    // Filter by document_type through versions (an artifact may have the type on any version)
    if (queryData.document_type) {
        const versionFilter: Record<string, unknown> = {
            document_type: queryData.document_type,
            artifact: { project: null, ...(isSharedType ? {} : { user: user.id }) },
        };
        const matchingVersions = await em.find(ArtifactVersionEntity, versionFilter, {
            fields: ['artifact'],
            populate: ['artifact'],
        });
        const matchingArtifactIds = [...new Set(matchingVersions.map((v) => v.artifact.id))];
        if (matchingArtifactIds.length === 0) {
            return NextResponse.json(createPaginatedResponse([], 0, queryData.page ?? 1, queryData.limit ?? 20));
        }
        query.andWhere({ 'a.id': { $in: matchingArtifactIds } });
    }

    const page = queryData.page ?? 1;
    const limit = queryData.limit ?? 20;

    const { nodes, totalCount } = await getPaginatedResult(query, { page, perPage: limit });

    const artifactIds = nodes.map((a: ArtifactEntity) => a.id);
    const latestByArtifact = await loadVersionsForArtifacts(em, artifactIds);

    const mappedNodes = nodes.map((artifact: ArtifactEntity) => {
        const latest = latestByArtifact.get(artifact.id);
        const ownerId = typeof artifact.user === 'object' && artifact.user ? artifact.user.id : artifact.user;
        return {
            ...wrap(artifact).toJSON(),
            proposed_version: latest ? wrap(latest).toJSON() : undefined,
            is_own: ownerId === user.id,
        };
    });

    return NextResponse.json(createPaginatedResponse(mappedNodes, totalCount, page, limit));
}

// ---------------------------------------------------------------------------
// Single artifact handlers
// ---------------------------------------------------------------------------

const ARTIFACT_ERRORS = {
    NOT_FOUND: () => NextResponse.json({ message: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 }),
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

// ---------------------------------------------------------------------------
// Import artifacts
// ---------------------------------------------------------------------------

/**
 * Import artifacts into a project.
 *
 * `projectId` can come from the route param (project-scoped route) or from
 * the request body (unified route).
 */
export async function handleImportArtifacts(
    req: NextRequest,
    user: UserEntity,
    projectId?: string,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const body = await req.json();
    const bodyData = validatePayload(ImportArtifactsBodySchema, body);
    if (bodyData instanceof NextResponse) return bodyData;

    const resolvedProjectId = projectId ?? bodyData.projectId;

    // Verify project ownership
    const project = await em.findOne(ProjectEntity, { id: resolvedProjectId, user: user.id });
    if (!project) {
        return NextResponse.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, { status: 404 });
    }

    const result = await importArtifactsToProject(em, user.id, resolvedProjectId, bodyData.artifactIds);

    // Queue embeddings for imported artifacts (fire-and-forget)
    if (result.imported > 0) {
        const embeddingQueue = createEmbeddingQueueAdapter({
            httpEndpoint: process.env.EMBEDDING_WORKER_URL ? `${process.env.EMBEDDING_WORKER_URL}/enqueue` : undefined,
            authSecret: process.env.AUTH_SECRET,
        });

        const embedPromises = result.details
            .filter((d) => d.status === 'imported' && d.newVersionId && d.content)
            .map((d) =>
                embeddingQueue
                    .send({
                        type: 'index_artifact_version',
                        projectId: resolvedProjectId,
                        versionId: d.newVersionId!,
                        content: d.content!,
                        documentName: d.key,
                        is_ai_content: true,
                    })
                    .catch((err) => console.error(`[import] Failed to queue embedding for ${d.key}:`, err)),
            );

        Promise.all(embedPromises).catch(() => {});
    }

    if (result.imported > 0 && user.clerkId) {
        broadcastUserEvent(user.clerkId, UserEventType.ProjectResourceImported, { projectId: resolvedProjectId });
    }

    // Strip content from response
    const responseDetails = result.details.map(({ content: _content, ...rest }) => rest);

    return NextResponse.json({ ...result, details: responseDetails });
}

// ---------------------------------------------------------------------------
// Resource handlers (user-scoped & project-scoped)
// ---------------------------------------------------------------------------

export async function handleListResources(
    req: NextRequest,
    user: UserEntity,
    projectId?: string,
): Promise<NextResponse> {
    const { em } = await getOrm();
    const { searchParams } = new URL(req.url);

    const queryData = validatePayload(ListUserResourcesQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        documentType: searchParams.get('documentType') ?? undefined,
        approvedOnly: searchParams.get('approvedOnly') ?? undefined,
        excludeProjectId: searchParams.get('excludeProjectId') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const { page, limit, documentType, approvedOnly, excludeProjectId } = queryData;

    const query = em.createQueryBuilder(ArtifactEntity, 'a').select('a.*');

    if (projectId) {
        // Project-scoped: imported resources + uploaded files
        query
            .leftJoin('a.project', 'p')
            .leftJoinAndSelect('a.current_version', 'cv')
            .where({
                'p.id': projectId,
                'p.user': user.id,
                $or: [{ [raw("a.metadata->>'importedFrom'")]: { $ne: null } }, { 'cv.is_uploaded': true }],
                $and: [{ $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }] }],
            });
    } else {
        // User-scoped: own resources + shared Company Profile / Human Persona from other users
        const SHARED_DOCUMENT_TYPES: string[] = ['Company Profile', 'Human Persona'];
        const hasSharedTypes = documentType?.some((dt) => SHARED_DOCUMENT_TYPES.includes(dt));

        query.leftJoinAndSelect('a.current_version', 'cv').where({
            'a.project': null,
            $or: [
                // Own artifacts (any document type, any status)
                { 'a.user': user.id },
                // Other users' artifacts — only shared document types with approved status
                ...(hasSharedTypes
                    ? [
                          {
                              'a.user': { $ne: user.id },
                              'cv.document_type': { $in: SHARED_DOCUMENT_TYPES },
                              'cv.status': 'approved',
                          },
                      ]
                    : []),
            ],
        });

        if (documentType?.length) {
            query.andWhere({ 'cv.document_type': { $in: documentType } });
        }
        if (approvedOnly) {
            query.andWhere({ 'cv.status': 'approved' });
        }

        // Exclude artifacts published from a specific project
        if (excludeProjectId) {
            query.andWhere({
                $or: [
                    { [raw("a.metadata->'publishedFrom'->>'projectId'")]: { $ne: excludeProjectId } },
                    { [raw("a.metadata->'publishedFrom'->>'projectId'")]: null },
                    { [raw('a.metadata')]: null },
                ],
            });
        }
    }

    if (documentType?.length) {
        const cases = documentType
            .map((dt, i) => `WHEN cv.document_type = '${dt.replace(/'/g, "''")}' THEN ${i}`)
            .join(' ');
        query.orderBy({ [raw(`CASE ${cases} ELSE ${documentType.length} END`)]: 'ASC', 'a.created_at': 'DESC' });
    } else {
        query.orderBy({ 'a.created_at': 'DESC' });
    }

    const { nodes, totalCount } = await getPaginatedResult(query, { page, perPage: limit });

    const artifactIds = nodes.map((a: ArtifactEntity) => a.id);
    const proposedMap = await loadVersionsForArtifacts(em, artifactIds, 'proposed');

    const data = nodes.map((a: ArtifactEntity) => {
        const ownerId = typeof a.user === 'object' && a.user ? a.user.id : a.user;
        return {
            ...wrap(a).toJSON(),
            proposed_version: proposedMap.get(a.id) ? wrap(proposedMap.get(a.id)!).toJSON() : undefined,
            is_own: ownerId === user.id,
        };
    });

    return NextResponse.json(createPaginatedResponse(data, totalCount, page, limit));
}

export async function handleGetResourceByKey(req: NextRequest, key: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();
    const { searchParams } = new URL(req.url);

    const queryData = validatePayload(GetArtifactQuerySchema, {
        version: searchParams.get('version') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const normalizedKey = normalizeArtifactKey(key);

    const artifact = await em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({
            'a.key': normalizedKey,
            $or: [{ 'a.user': user.id }, { [raw("a.metadata->>'stagedBy'")]: user.id }],
            $and: [{ $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }] }],
        })
        .getSingleResult();

    if (!artifact) {
        return NextResponse.json({ error: 'Resource not found', code: 'RESOURCE_NOT_FOUND' }, { status: 404 });
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

export async function handleRemoveProjectResource(
    projectId: string,
    artifactId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const artifact = await em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.project', 'p')
        .where({
            'a.id': artifactId,
            'p.id': projectId,
            'p.user': user.id,
            [raw("a.metadata->>'importedFrom'")]: { $ne: null },
        })
        .getSingleResult();

    if (!artifact) {
        return NextResponse.json({ message: 'Resource not found', code: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    }

    if ((artifact.metadata as Record<string, unknown> | null)?.importedFromPublic === true) {
        return NextResponse.json(
            { message: 'Cannot remove a permanently attached resource', code: 'RESOURCE_PROTECTED' },
            { status: 403 },
        );
    }

    await em.transactional(async (txEm) => {
        await txEm.nativeDelete(ArtifactVersionEntity, { artifact: artifact.id });
        await txEm.nativeDelete(ArtifactEntity, { id: artifact.id });
    });

    if (user.clerkId) {
        await broadcastUserEvent(user.clerkId, UserEventType.ProjectResourceDeleted, { projectId, artifactId });
    }

    return NextResponse.json({ success: true, message: 'Resource removed from project' });
}

// ---------------------------------------------------------------------------
// File status (batch)
// ---------------------------------------------------------------------------

/**
 * GET /api/artifacts/files/status?fileIds=id1,id2,id3
 * Returns status of multiple artifact files — used by frontend to poll extraction progress.
 */
export async function handleGetFileStatuses(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();
    const fileIds = req.nextUrl.searchParams.get('fileIds')?.split(',').filter(Boolean) ?? [];

    if (fileIds.length === 0) {
        return NextResponse.json(
            { error: 'fileIds query param is required', code: 'MISSING_FILE_IDS' },
            { status: 400 },
        );
    }

    if (fileIds.length > 50) {
        return NextResponse.json({ error: 'Max 50 fileIds per request', code: 'TOO_MANY_FILE_IDS' }, { status: 400 });
    }

    const files = await em
        .createQueryBuilder(ArtifactFileEntity, 'f')
        .select('f.*')
        .leftJoinAndSelect('f.artifact_version', 'v')
        .leftJoin('v.artifact', 'a')
        .leftJoin('a.project', 'p')
        .leftJoin('a.chat', 'c')
        .where({
            'f.id': { $in: fileIds },
            $or: [
                { 'p.user': user.id },
                { 'c.user': user.id },
                { 'a.user': user.id },
                { [raw("a.metadata->>'stagedBy'")]: user.id },
            ],
        })
        .getResultList();

    return NextResponse.json({
        files: files.map((f) => ({
            fileId: f.id,
            versionId: f.artifact_version.id,
            status: f.status,
            originalName: f.original_name,
        })),
    });
}
