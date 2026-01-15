import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { CreateProjectBodySchema, ListProjectsQuerySchema, type ProjectDto } from '@/lib/schema/project';

async function handleGetProjects(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const pageParam = searchParams.get('page');
    const limitParam = searchParams.get('limit');
    const queryData = validatePayload(ListProjectsQuerySchema, {
        page: pageParam && pageParam.trim() !== '' ? pageParam : undefined,
        limit: limitParam && limitParam.trim() !== '' ? limitParam : undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const query = em
        .createQueryBuilder(ProjectEntity, 'p')
        .select('p.*')
        .where({ 'p.user': user.id })
        .orderBy({ 'p.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(query, {
        page: queryData.page ?? 1,
        perPage: queryData.limit ?? 20,
    });

    const mappedNodes = nodes.map((project: ProjectEntity): ProjectDto => {
        return wrap(project).toJSON();
    });

    return NextResponse.json(
        createPaginatedResponse(mappedNodes, totalCount, queryData.page ?? 1, queryData.limit ?? 20),
    );
}

async function handleCreateProject(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const body = await req.json();
    const bodyData = validatePayload(CreateProjectBodySchema, body);

    if (bodyData instanceof NextResponse) return bodyData;

    const { name, description } = bodyData;

    const project = em.create(ProjectEntity, {
        name,
        description: description ?? null,
        user,
    });

    await em.persistAndFlush(project);

    const dto: ProjectDto = wrap(project).toJSON();
    return NextResponse.json(dto, { status: 201 });
}

export const GET = withAuth(async (req, user) => {
    return await handleGetProjects(req, user);
});

export const POST = withAuth(async (req, user) => {
    return await handleCreateProject(req, user);
});
