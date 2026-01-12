import { type NextRequest, NextResponse } from 'next/server';
import { wrap } from '@mikro-orm/core';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { validatePayload } from '@/lib/api/validation';
import { UpdateProjectBodySchema, type ProjectDto } from '@/lib/schema/project';
import { PROJECT_ERRORS } from '@/app/api/projects/errors';

async function handleGetProject(
    req: NextRequest,
    projectId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const project = await em.findOne(ProjectEntity, { id: projectId, user: { id: user.id } });
    if (!project) {
        return PROJECT_ERRORS.PROJECT_NOT_FOUND;
    }

    const dto: ProjectDto = wrap(project).toJSON();
    return NextResponse.json(dto);
}

async function handleUpdateProject(
    req: NextRequest,
    projectId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const project = await em.findOne(ProjectEntity, { id: projectId, user: { id: user.id } });
    if (!project) {
        return PROJECT_ERRORS.PROJECT_NOT_FOUND;
    }

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

async function handleDeleteProject(
    req: NextRequest,
    projectId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const project = await em.findOne(ProjectEntity, { id: projectId, user: { id: user.id } });
    if (!project) {
        return PROJECT_ERRORS.PROJECT_NOT_FOUND;
    }

    await em.removeAndFlush(project);

    return NextResponse.json({ message: 'Project deleted successfully' }, { status: 200 });
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return await handleGetProject(request, projectId, user);
    })(req);
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return await handleUpdateProject(request, projectId, user);
    })(req);
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return await handleDeleteProject(request, projectId, user);
    })(req);
}

