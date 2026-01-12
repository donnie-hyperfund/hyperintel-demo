import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { validatePayload } from '@/lib/api/validation';
import { UpdateProjectBodySchema, type ProjectResponseDto } from '../schemas';
import { PROJECT_ERRORS } from '../errors';

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

    const response: ProjectResponseDto = {
        id: project.id,
        name: project.name,
        description: project.description ?? null,
        userId: project.user.id,
        createdAt: project.created_at.toISOString(),
        updatedAt: project.updated_at.toISOString(),
    };

    return NextResponse.json(response);
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

