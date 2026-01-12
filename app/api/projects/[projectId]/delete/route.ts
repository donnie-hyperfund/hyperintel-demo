import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { PROJECT_ERRORS } from '@/app/api/projects/errors';

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

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return await handleDeleteProject(request, projectId, user);
    })(req);
}

