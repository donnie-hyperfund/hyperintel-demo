import { wrap } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { type NextRequest, NextResponse } from 'next/server';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { broadcastUserEvent } from '@/lib/broadcast/user-event';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { getAvailablePresets } from '@/lib/presets';
import { ListProjectsQuerySchema, type ProjectDto, UpdateProjectBodySchema } from '@/lib/schema/project';

function projectNotFound() {
    return NextResponse.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, { status: 404 });
}

function getProjectFilter(userId: string, includeArchived = false) {
    return {
        user: { id: userId },
        ...(includeArchived ? {} : { archived_at: null }),
    };
}

function findProjectForUser(
    em: EntityManager,
    projectId: string,
    userId: string,
    options?: { includeArchived?: boolean },
) {
    return em.findOne(ProjectEntity, {
        id: projectId,
        ...getProjectFilter(userId, options?.includeArchived),
    });
}

async function deleteProjectGraph(em: EntityManager, projectId: string, userId: string): Promise<void> {
    await em.transactional(async (txEm) => {
        const txConnection = txEm.getConnection();

        await txConnection.execute(`update "artifacts" set "current_version_id" = null where "project_id" = ?`, [
            projectId,
        ]);
        await txConnection.execute(
            `delete from "artifact_embeddings"
             where "project_id" = ?
                or "artifact_version_id" in (
                    select av.id
                    from "artifact_versions" av
                    inner join "artifacts" a on a.id = av."artifact_id"
                    where a."project_id" = ?
                )`,
            [projectId, projectId],
        );
        await txConnection.execute(
            `delete from "artifact_files"
             where "artifact_version_id" in (
                select av.id
                from "artifact_versions" av
                inner join "artifacts" a on a.id = av."artifact_id"
                where a."project_id" = ?
             )`,
            [projectId],
        );
        await txConnection.execute(
            `delete from "artifact_versions"
             where "artifact_id" in (
                select id
                from "artifacts"
                where "project_id" = ?
             )`,
            [projectId],
        );
        await txConnection.execute(
            `delete from "chat_messages"
             where "chat_id" in (
                select id
                from "chats"
                where "project_id" = ?
             )`,
            [projectId],
        );
        await txConnection.execute(`delete from "artifacts" where "project_id" = ?`, [projectId]);
        await txConnection.execute(`delete from "chats" where "project_id" = ?`, [projectId]);

        await txConnection.execute(`delete from "projects" where "id" = ? and "user_id" = ?`, [projectId, userId]);
    });
}

export async function handleListProjects(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListProjectsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        status: searchParams.get('status') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const query = em
        .createQueryBuilder(ProjectEntity, 'p')
        .select('p.*')
        .where({ 'p.user': user.id })
        .orderBy({ 'p.created_at': 'DESC' });

    if (!queryData.status || queryData.status === 'active') {
        query.andWhere({ 'p.archived_at': null });
    } else if (queryData.status === 'archived') {
        query.andWhere({ 'p.archived_at': { $ne: null } });
    }

    const { nodes, totalCount } = await getPaginatedResult(query, {
        page: queryData.page ?? 1,
        perPage: queryData.limit ?? 20,
    });

    const mappedNodes = nodes.map((project: ProjectEntity): ProjectDto => {
        return wrap(project).toJSON() as ProjectDto;
    });

    return NextResponse.json(
        createPaginatedResponse(mappedNodes, totalCount, queryData.page ?? 1, queryData.limit ?? 20),
    );
}

export async function handleGetProject(projectId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const project = await findProjectForUser(em, projectId, user.id);
    if (!project) return projectNotFound();

    const dto = wrap(project).toJSON() as ProjectDto;
    return NextResponse.json(dto);
}

export async function handleUpdateProject(
    req: NextRequest,
    projectId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const project = await findProjectForUser(em, projectId, user.id, { includeArchived: true });
    if (!project) return projectNotFound();

    const body = await req.json();
    const bodyData = validatePayload(UpdateProjectBodySchema, body);

    if (bodyData instanceof NextResponse) return bodyData;

    const { name, description, archived, preferred_model } = bodyData;

    if (name !== undefined) {
        project.name = name;
    }

    if (description !== undefined) {
        project.description = description;
    }

    if (preferred_model !== undefined) {
        if (preferred_model !== null) {
            const available = getAvailablePresets(process.env.ALLOWED_PRESETS, process.env.BLOCKED_PRESETS);
            if (!available.some((preset) => preset.id === preferred_model)) {
                return NextResponse.json(
                    { error: `Preset '${preferred_model}' is not available`, code: 'INVALID_PRESET' },
                    { status: 400 },
                );
            }
        }
        project.preferred_model = preferred_model;
    }

    let eventType: 'project_archived' | 'project_unarchived' | null = null;
    if (archived !== undefined) {
        const isArchived = Boolean(project.archived_at);
        if (archived && !isArchived) {
            project.archived_at = new Date();
            eventType = 'project_archived';
        } else if (!archived && isArchived) {
            project.archived_at = null;
            eventType = 'project_unarchived';
        }
    }

    await em.persistAndFlush(project);

    if (eventType && user.clerkId) {
        broadcastUserEvent(user.clerkId, eventType, { projectId: project.id }).catch(console.error);
    }

    const dto = wrap(project).toJSON() as ProjectDto;
    return NextResponse.json(dto);
}

export async function handleDeleteProject(projectId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const project = await findProjectForUser(em, projectId, user.id, { includeArchived: true });
    if (!project) return projectNotFound();

    await deleteProjectGraph(em, project.id, user.id);

    if (user.clerkId) {
        broadcastUserEvent(user.clerkId, 'project_deleted', { projectId: project.id }).catch(console.error);
    }

    return NextResponse.json({ message: 'Project deleted successfully' }, { status: 200 });
}
