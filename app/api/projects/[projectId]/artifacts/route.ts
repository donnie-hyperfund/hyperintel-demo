import { raw, wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { loadVersionsForArtifacts } from '@/lib/artifacts/queries';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { ListArtifactsQuerySchema } from '@/lib/schema/artifact';

async function handleGetArtifacts(req: NextRequest, projectId: string, user: UserEntity): Promise<NextResponse> {
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

    // If key is provided, fetch single artifact by key
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

        // If specific version requested, use it as proposed and version-1 as current (for diffing)
        if (queryData.version !== undefined) {
            const requestedVersion = await em.findOne(ArtifactVersionEntity, {
                artifact: artifact.id,
                version: queryData.version,
            });
            if (!requestedVersion) {
                return NextResponse.json({ error: 'Version not found', code: 'VERSION_NOT_FOUND' }, { status: 404 });
            }

            // Fetch previous version for diff comparison (undefined if version is 1)
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

        // Default: fetch actual current and proposed versions
        const proposedVersion = await em.findOne(ArtifactVersionEntity, {
            artifact: artifact.id,
            status: 'proposed',
        });

        return NextResponse.json({
            ...wrap(artifact).toJSON(),
            proposed_version: proposedVersion ? wrap(proposedVersion).toJSON() : undefined,
        });
    }

    const proposedSub = (col: string) =>
        `(SELECT pv.${col} FROM artifact_versions pv WHERE pv.artifact_id = a.id AND pv.status = 'proposed' ORDER BY pv.version DESC LIMIT 1)`;

    const query = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.project', 'p')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({
            'p.id': projectId,
            'p.user': user.id,
            $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }],
        });

    // Exclude imported resources (they are shown via the project resources endpoint)
    query.andWhere({
        $or: [
            { [raw("a.metadata->>'importedFrom'")]: null },
            { [raw('a.metadata')]: null },
        ],
    });

    if (queryData.visibility?.length) {
        const booleans = queryData.visibility.map((v) => v === 'internal');
        query.andWhere({
            [raw(`COALESCE(${proposedSub('is_internal')}, cv.is_internal)`)]: { $in: booleans },
        });
    }

    if (queryData.status?.length) {
        query.andWhere({
            [raw(`COALESCE(${proposedSub('status')}, cv.status)`)]: { $in: queryData.status },
        });
    }

    if (queryData.chatId?.length) {
        query.andWhere({
            [raw(`COALESCE(${proposedSub('chat_id')}, cv.chat_id)`)]: { $in: queryData.chatId },
        });
    }

    query.orderBy({ 'a.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(query, {
        page: queryData.page ?? 1,
        perPage: queryData.limit ?? 20,
    });

    // Batch load proposed versions for all artifacts
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

export function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return await handleGetArtifacts(request, projectId, user);
    })(req);
}
