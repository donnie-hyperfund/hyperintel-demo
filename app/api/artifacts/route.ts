import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { loadVersionsForArtifacts } from '@/lib/artifacts/queries';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { ListArtifactsQuerySchema } from '@/lib/schema/artifact';

/**
 * GET /api/artifacts — List user-scoped artifacts (intake results).
 *
 * Returns paginated artifacts where project_id IS NULL and user_id = current user.
 * Used by the frontend to show available intake documents for import.
 *
 * Query params:
 *   - document_type: Filter by document type (e.g. "Company Profile", "Human Persona")
 *   - page: Page number (default 1)
 *   - limit: Items per page (default 20, max 100)
 */
async function handleGetUserArtifacts(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListArtifactsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        document_type: searchParams.get('document_type') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const query = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({ 'a.user': user.id, 'a.project': null })
        .orderBy({ 'a.created_at': 'DESC' });

    // If document_type filter is provided, find artifact IDs through versions first
    if (queryData.document_type) {
        const matchingVersions = await em.find(
            ArtifactVersionEntity,
            { document_type: queryData.document_type, artifact: { user: user.id, project: null } },
            { fields: ['artifact'], populate: ['artifact'] },
        );
        const artifactIds = [...new Set(matchingVersions.map((v) => v.artifact.id))];
        if (artifactIds.length === 0) {
            return NextResponse.json(createPaginatedResponse([], 0, queryData.page ?? 1, queryData.limit ?? 20));
        }
        query.andWhere({ 'a.id': { $in: artifactIds } });
    }

    const { nodes, totalCount } = await getPaginatedResult(query, {
        page: queryData.page ?? 1,
        perPage: queryData.limit ?? 20,
    });

    const artifactIds = nodes.map((a: ArtifactEntity) => a.id);
    const latestByArtifact = await loadVersionsForArtifacts(em, artifactIds);

    const mapped = nodes.map((artifact: ArtifactEntity) => {
        const latest = latestByArtifact.get(artifact.id);
        return {
            ...wrap(artifact).toJSON(),
            proposed_version: latest ? wrap(latest).toJSON() : undefined,
        };
    });

    return NextResponse.json(createPaginatedResponse(mapped, totalCount, queryData.page ?? 1, queryData.limit ?? 20));
}

export function GET(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => {
        return handleGetUserArtifacts(request, user);
    })(req);
}
