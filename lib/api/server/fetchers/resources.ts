import 'server-only';

import { wrap } from '@mikro-orm/core';
import type { PaginatedResponse } from '@/lib/api/pagination';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { loadVersionsForArtifacts, whereArtifactHasVersions } from '@/lib/artifacts/queries';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import type { ArtifactDto } from '@/lib/schema/artifact';

export async function fetchResources(
    user: UserEntity,
    { page = 1, limit = 20 }: { page?: number; limit?: number } = {},
): Promise<PaginatedResponse<ArtifactDto>> {
    const { em } = await getOrm();

    const query = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({ user: user.id, project: null })
        .andWhere(whereArtifactHasVersions('a'))
        .orderBy({ 'cv.document_type': 'ASC', 'a.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(query, { page, perPage: limit });

    const artifactIds = nodes.map((a: ArtifactEntity) => a.id);
    const proposedMap = await loadVersionsForArtifacts(em, artifactIds, 'proposed');

    const data = nodes.map((a: ArtifactEntity) => ({
        ...wrap(a).toJSON(),
        proposed_version: proposedMap.get(a.id) ? wrap(proposedMap.get(a.id)!).toJSON() : undefined,
    })) as ArtifactDto[];

    return createPaginatedResponse(data, totalCount, page, limit);
}
