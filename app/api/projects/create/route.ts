import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { validatePayload } from '@/lib/api/validation';
import { CreateProjectBodySchema, type ProjectResponseDto } from '../schemas';

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

    const response: ProjectResponseDto = {
        id: project.id,
        name: project.name,
        description: project.description ?? null,
        userId: project.user.id,
        createdAt: project.created_at.toISOString(),
        updatedAt: project.updated_at.toISOString(),
    };

    return NextResponse.json(response, { status: 201 });
}

export const POST = withAuth(async (req, user) => {
    return await handleCreateProject(req, user);
});
