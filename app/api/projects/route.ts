import { wrap } from '@mikro-orm/core';
import type { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { broadcastUserEvent } from '@/lib/broadcast/user-event';
import { handleListProjects } from '@/lib/projects/handlers';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { CreateProjectBodySchema, ListProjectsQuerySchema, type ProjectDto } from '@/lib/schema/project';

export function GET(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleListProjects(request, user))(req);
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

    // Broadcast project_created to all user WS connections (fire-and-forget)
    if (user.clerkId) {
        broadcastUserEvent(user.clerkId, 'project_created', { projectId: project.id }).catch(console.error);
    }

    const dto: ProjectDto = wrap(project).toJSON();
    return NextResponse.json(dto, { status: 201 });
}

export function POST(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleCreateProject(request, user))(req);
}
