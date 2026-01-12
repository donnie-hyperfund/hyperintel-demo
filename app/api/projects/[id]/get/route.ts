import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { PROJECT_ERRORS } from '../../errors';
import type { ProjectResponseDto } from '../../schemas';

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

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { id } = await params;
        return await handleGetProject(request, id, user);
    })(req);
}
