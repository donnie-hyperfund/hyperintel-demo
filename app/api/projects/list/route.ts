import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { getPaginatedResult, createPaginatedResponse } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { ListProjectsQuerySchema, type ProjectResponseDto } from '../schemas';

async function handleGetProjects(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListProjectsQuerySchema, {
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
    });

    if (queryData instanceof NextResponse) return queryData;

    const query = em.createQueryBuilder(ProjectEntity, 'p')
        .select('p.*')
        .where({ 'p.user': user.id })
        .orderBy({ 'p.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(
        query,
        {
            page: queryData.page ?? 1,
            perPage: queryData.limit ?? 20,
        },
    );

    const responseData: ProjectResponseDto[] = nodes.map((project: any) => ({
        id: project.id,
        name: project.name,
        description: project.description ?? null,
        userId: user.id,
        createdAt: new Date(project.created_at).toISOString(),
        updatedAt: new Date(project.updated_at).toISOString(),
    }));

    return NextResponse.json(
        createPaginatedResponse(
            responseData,
            totalCount,
            queryData.page ?? 1,
            queryData.limit ?? 20,
        ),
    );
}

export const GET = withAuth(async (req, user) => {
    return await handleGetProjects(req, user);
});
