import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { CreateProjectBodySchema, ListProjectsQuerySchema, type ProjectDto, UpdateProjectBodySchema } from '@/lib/schema/project';

function projectNotFound() {
    return NextResponse.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, { status: 404 });
}

export async function handleListProjects(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListProjectsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
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

export async function handleCreateProject(req: NextRequest, user: UserEntity): Promise<NextResponse> {
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

export async function handleGetProject(projectId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const project = await em.findOne(ProjectEntity, { id: projectId, user: { id: user.id } });
    if (!project) return projectNotFound();

    const dto: ProjectDto = wrap(project).toJSON();
    return NextResponse.json(dto);
}

export async function handleUpdateProject(req: NextRequest, projectId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const project = await em.findOne(ProjectEntity, { id: projectId, user: { id: user.id } });
    if (!project) return projectNotFound();

    const body = await req.json();
    const bodyData = validatePayload(UpdateProjectBodySchema, body);

    if (bodyData instanceof NextResponse) return bodyData;

    const { name, description } = bodyData;

    if (name !== undefined) {
        project.name = name;
    }

    if (description !== undefined) {
        project.description = description;
    }

    await em.persistAndFlush(project);

    const dto: ProjectDto = wrap(project).toJSON();
    return NextResponse.json(dto);
}

export async function handleDeleteProject(projectId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const project = await em.findOne(ProjectEntity, { id: projectId, user: { id: user.id } });
    if (!project) return projectNotFound();

    await em.removeAndFlush(project);

    return NextResponse.json({ message: 'Project deleted successfully' }, { status: 200 });
}
