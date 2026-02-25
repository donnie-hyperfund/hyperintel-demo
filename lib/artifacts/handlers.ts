import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { loadVersionsForArtifacts } from '@/lib/artifacts/queries';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { ListUserResourcesQuerySchema } from '@/lib/schema/artifact';

export async function handleListResources(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();
    const { searchParams } = new URL(req.url);

    const queryData = validatePayload(ListUserResourcesQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        documentType: searchParams.get('documentType') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const { page, limit, documentType } = queryData;

    const where: Record<string, unknown> = { user: user.id, project: null };

    if (documentType?.length) {
        where.current_version = { document_type: { $in: documentType } };
    }

    const query = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where(where)
        .orderBy({ 'cv.document_type': 'ASC', 'a.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(query, { page, perPage: limit });

    const artifactIds = nodes.map((a: ArtifactEntity) => a.id);
    const proposedMap = await loadVersionsForArtifacts(em, artifactIds, 'proposed');

    const data = nodes.map((a: ArtifactEntity) => ({
        ...wrap(a).toJSON(),
        proposed_version: proposedMap.get(a.id) ? wrap(proposedMap.get(a.id)!).toJSON() : undefined,
    }));

    return NextResponse.json(createPaginatedResponse(data, totalCount, page, limit));
}
