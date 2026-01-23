import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { type ArtifactDto, ListArtifactsQuerySchema } from '@/lib/schema/artifact';

async function handleGetArtifacts(req: NextRequest, projectId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListArtifactsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        key: searchParams.get('key') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    // If key is provided, fetch single artifact by key
    if (queryData.key) {
        const artifact = await em
            .createQueryBuilder(ArtifactEntity, 'a')
            .select('a.*')
            .leftJoin('a.chat', 'c')
            .leftJoin('a.project', 'p')
            .leftJoinAndSelect('a.current_version', 'cv')
            .where({
                'a.key': queryData.key,
                'p.id': projectId,
                'p.user': user.id,
            })
            .getSingleResult();

        if (!artifact) {
            return NextResponse.json({ error: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 });
        }

        const dto: ArtifactDto = wrap(artifact).toJSON();
        return NextResponse.json(dto);
    }

    const query = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.chat', 'c')
        .leftJoin('a.project', 'p')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({
            'p.id': projectId,
            'p.user': user.id,
        })
        .orderBy({ 'a.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(query, {
        page: queryData.page ?? 1,
        perPage: queryData.limit ?? 20,
    });

    const mappedNodes = nodes.map((artifact: ArtifactEntity): ArtifactDto => {
        return wrap(artifact).toJSON();
    });

    return NextResponse.json(
        createPaginatedResponse(mappedNodes, totalCount, queryData.page ?? 1, queryData.limit ?? 20),
    );
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return await handleGetArtifacts(request, projectId, user);
    })(req);
}
