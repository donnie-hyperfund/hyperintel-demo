import { raw, wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { loadVersionsForArtifacts } from '@/lib/artifacts/queries';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { GetArtifactQuerySchema, ListUserResourcesQuerySchema } from '@/lib/schema/artifact';

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
    });

    if (queryData instanceof NextResponse) return queryData;

    const { page, limit, documentType, approvedOnly } = queryData;

    const query = em.createQueryBuilder(ArtifactEntity, 'a').select('a.*');

    if (projectId) {
        // Project-scoped: imported resources only
        query
            .leftJoin('a.project', 'p')
            .leftJoinAndSelect('a.current_version', 'cv')
            .where({
                'p.id': projectId,
                'p.user': user.id,
                [raw("a.metadata->>'importedFrom'")]: { $ne: null },
                $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }],
            });
    } else {
        // User-scoped: global resources
        const where: Record<string, unknown> = { user: user.id, project: null };
        if (documentType?.length) {
            where.current_version = { document_type: { $in: documentType } };
        }
        if (approvedOnly) {
            where['cv.status'] = 'approved';
        }
        query.leftJoinAndSelect('a.current_version', 'cv').where(where);
    }

    query.orderBy({ 'cv.document_type': 'ASC', 'a.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(query, { page, perPage: limit });

    const artifactIds = nodes.map((a: ArtifactEntity) => a.id);
    const proposedMap = await loadVersionsForArtifacts(em, artifactIds, 'proposed');

    const data = nodes.map((a: ArtifactEntity) => ({
        ...wrap(a).toJSON(),
        proposed_version: proposedMap.get(a.id) ? wrap(proposedMap.get(a.id)!).toJSON() : undefined,
    }));

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
            'a.user': user.id,
            $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }],
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

    await em.transactional(async (txEm) => {
        await txEm.nativeDelete(ArtifactVersionEntity, { artifact: artifact.id });
        await txEm.nativeDelete(ArtifactEntity, { id: artifact.id });
    });

    return NextResponse.json({ success: true, message: 'Resource removed from project' });
}
