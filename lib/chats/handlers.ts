/**
 * Shared chat handler functions.
 *
 * Used by both project-scoped routes (`/api/projects/[projectId]/chats/...`)
 * and unified routes (`/api/chats/...`) to avoid duplicating ownership
 * checks and query logic. The optional `projectId` parameter controls
 * how ownership is verified:
 *
 * - With projectId: `WHERE project.id = projectId AND project.user = userId`
 * - Without:        `WHERE chat.user = userId OR project.user = userId`
 */

import { sql, wrap } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { type NextRequest, NextResponse } from 'next/server';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { ListArtifactsQuerySchema } from '@/lib/schema/artifact';
import { CreateUnifiedChatBodySchema } from '@/lib/schema/chat';
import { type ChatDocumentSummaryDto, type ChatDto, type ChatMessageDto, CreateMessageBodySchema, ListChatsQuerySchema, ListMessagesQuerySchema } from '@/lib/schema/message';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chatNotFound() {
    return NextResponse.json({ error: 'Chat not found', code: 'CHAT_NOT_FOUND' }, { status: 404 });
}

/** Apply ownership WHERE clause to a query builder that already has `c` (chat) and `p` (project) aliases. */
function applyOwnership(qb: { where: (...args: any[]) => any }, chatId: string, userId: string, projectId?: string) {
    if (projectId) {
        qb.where({ 'c.id': chatId, 'p.id': projectId, 'p.user': userId });
    } else {
        qb.where({ 'c.id': chatId, $or: [{ 'c.user': userId }, { 'p.user': userId }] });
    }
}

/**
 * Verify user has access to a chat.
 */
export async function verifyChatAccess(
    em: EntityManager,
    chatId: string,
    userId: string,
    projectId?: string,
): Promise<ChatEntity | null> {
    const qb = em
        .createQueryBuilder(ChatEntity, 'c')
        .select('c.*')
        .leftJoin('c.project', 'p');

    applyOwnership(qb, chatId, userId, projectId);

    return qb.getSingleResult();
}

// ---------------------------------------------------------------------------
// Chat handlers
// ---------------------------------------------------------------------------

export async function handleCreateChat(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const json = await req.json();
    const bodyData = validatePayload(CreateUnifiedChatBodySchema, json);

    if (bodyData instanceof NextResponse) return bodyData;

    const { projectId, framework, category, title } = bodyData;

    // Must specify either projectId (phase chat) or framework (intake chat)
    if (!projectId && !framework) {
        return NextResponse.json(
            { error: 'Either projectId or framework is required', code: 'BAD_REQUEST' },
            { status: 400 },
        );
    }

    // Validate: category required for hpf
    if (framework === 'hpf' && !category) {
        return NextResponse.json(
            { error: 'Category is required for Human Persona Framework', code: 'BAD_REQUEST' },
            { status: 400 },
        );
    }

    if (projectId) {
        // Project chat
        const project = await em.findOne(ProjectEntity, { id: projectId, user: user.id });
        if (!project) {
            return NextResponse.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, { status: 404 });
        }

        const chat = em.create(ChatEntity, {
            project: projectId,
            user,
            phase: 'active',
            ...(title && { summary: title }),
        });
        await em.persistAndFlush(chat);

        const chatDto: ChatDto = wrap(chat).toJSON();
        return NextResponse.json(chatDto, { status: 201 });
    }

    // Intake chat
    const chat = em.create(ChatEntity, {
        type: 'intake',
        phase: 'active',
        user,
        metadata: {
            framework,
            ...(category && { category }),
        },
    });
    await em.persistAndFlush(chat);

    const chatDto: ChatDto = wrap(chat).toJSON();
    return NextResponse.json(chatDto, { status: 201 });
}

/**
 * Get a single chat with message count, first message, and document summaries.
 */
export async function handleGetChat(
    chatId: string,
    user: UserEntity,
    projectId?: string,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const qb = em
        .createQueryBuilder(ChatEntity, 'c')
        .select('c.*')
        .addSelect(sql`COUNT(DISTINCT m.id) as message_count`)
        .addSelect(sql`(
            SELECT m2.content
            FROM chat_messages m2
            WHERE m2.chat_id = c.id
            ORDER BY m2.created_at ASC
            LIMIT 1
        ) as first_message_content`)
        .leftJoin('c.project', 'p')
        .leftJoin('c.messages', 'm');

    applyOwnership(qb, chatId, user.id, projectId);

    const chat = await qb.groupBy(['c.id']).getSingleResult();
    if (!chat) return chatNotFound();

    if (chat.message_count) {
        chat.message_count = Number(chat.message_count);
    }

    // Include document summaries for project chats
    if (chat.project) {
        const artifacts = await em.find(
            ArtifactEntity,
            { versions: { chat: chatId } },
            { populate: ['current_version', 'versions'] },
        );

        const documents: ChatDocumentSummaryDto[] = artifacts.map((artifact) => {
            const currentVersion = artifact.current_version;
            const newestVersion = artifact.versions.getItems().reduce((max, v) => Math.max(max, v.version), 0);
            const newestVersionEntity = artifact.versions.getItems().find((v) => v.version === newestVersion);
            return {
                id: artifact.id,
                key: artifact.key,
                title: artifact.title,
                current_version: currentVersion?.version ?? null,
                newest_version: newestVersion,
                status: newestVersionEntity?.status ?? 'approved',
                created_at: newestVersionEntity?.created_at ?? artifact.created_at,
                updated_at: artifact.updated_at,
            };
        });

        const hasPendingChanges = artifacts.some((artifact) =>
            artifact.versions.getItems().some((v) => v.status === 'proposed'),
        );

        const dto: ChatDto = {
            ...(wrap(chat).toJSON() as ChatDto),
            documents,
            has_pending_changes: hasPendingChanges,
        };
        return NextResponse.json(dto);
    }

    return NextResponse.json(wrap(chat).toJSON());
}

/**
 * Delete a chat.
 */
export async function handleDeleteChat(
    chatId: string,
    user: UserEntity,
    projectId?: string,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const chat = await verifyChatAccess(em, chatId, user.id, projectId);
    if (!chat) return chatNotFound();

    await em.removeAndFlush(chat);
    return NextResponse.json({ message: 'Chat deleted successfully' });
}

// ---------------------------------------------------------------------------
// Chat list handler
// ---------------------------------------------------------------------------

/**
 * List chats (paginated) with message count and first message preview.
 */
export async function handleListChats(
    req: NextRequest,
    user: UserEntity,
    projectId?: string,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListChatsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        type: searchParams.get('type') ?? undefined,
        projectId: searchParams.get('projectId') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const qb = em
        .createQueryBuilder(ChatEntity, 'c')
        .select('c.*')
        .addSelect(sql`COUNT(DISTINCT m.id) as message_count`)
        .addSelect(sql`(
            SELECT m2.content
            FROM chat_messages m2
            WHERE m2.chat_id = c.id
            ORDER BY m2.created_at ASC
            LIMIT 1
        ) as first_message_content`)
        .leftJoin('c.project', 'p')
        .leftJoin('c.messages', 'm');

    if (projectId) {
        qb.where({ 'p.id': projectId, 'p.user': user.id });
    } else {
        qb.where({ $or: [{ 'c.user': user.id }, { 'p.user': user.id }] });
    }

    if (queryData.type) {
        qb.andWhere({ 'c.type': queryData.type });
    }
    if (queryData.projectId) {
        qb.andWhere({ 'c.project': queryData.projectId });
    }

    qb.groupBy(['c.id']).orderBy(projectId ? { 'c.phase_index': 'ASC' } : { 'c.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(qb, {
        page: queryData.page ?? 1,
        perPage: queryData.limit ?? 20,
    });

    const mappedNodes = nodes.map((chat: any): ChatDto => {
        const chatEntity = chat as ChatEntity;
        chatEntity.message_count = parseInt(chat.message_count) || 0;
        chatEntity.first_message_content = chat.first_message_content || null;
        return wrap(chatEntity).toJSON();
    });

    return NextResponse.json(
        createPaginatedResponse(mappedNodes, totalCount, queryData.page ?? 1, queryData.limit ?? 20),
    );
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

/**
 * List messages for a chat (paginated).
 */
export async function handleGetMessages(
    req: NextRequest,
    chatId: string,
    user: UserEntity,
    projectId?: string,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const chat = await verifyChatAccess(em, chatId, user.id, projectId);
    if (!chat) return chatNotFound();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListMessagesQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        role: searchParams.get('role') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const where: Record<string, unknown> = { chat: chatId };
    if (queryData.role) {
        where.role = queryData.role;
    }

    const query = em
        .createQueryBuilder(ChatMessageEntity, 'm')
        .select('m.*')
        .where(where)
        .orderBy({ 'm.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(query, {
        page: queryData.page ?? 1,
        perPage: queryData.limit ?? 20,
    });

    const mappedNodes = nodes.map((message: ChatMessageEntity): ChatMessageDto => wrap(message).toJSON());

    return NextResponse.json(
        createPaginatedResponse(mappedNodes, totalCount, queryData.page ?? 1, queryData.limit ?? 20),
    );
}

/**
 * Create a message in a chat. Auto-creates the chat if it doesn't exist
 * and a projectId is resolvable (from the body or the existing chat entity).
 */
export async function handleCreateMessage(
    req: NextRequest,
    chatId: string,
    user: UserEntity,
    projectId?: string,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const body = await req.json();
    const bodyData = validatePayload(CreateMessageBodySchema, body);
    if (bodyData instanceof NextResponse) return bodyData;

    const { content, role, metadata } = bodyData;

    const result = await em.transactional(async (em) => {
        let chat = await verifyChatAccess(em, chatId, user.id, projectId);

        if (!chat) {
            // Auto-create chat if projectId is available
            const resolvedProjectId = projectId ?? (body.projectId as string | undefined);
            if (!resolvedProjectId) return null;

            const project = await em.findOne(ProjectEntity, { id: resolvedProjectId, user: { id: user.id } });
            if (!project) return null;

            chat = em.create(ChatEntity, {
                id: chatId,
                project,
                phase: 'chat',
                phase_index: await em.count(ChatEntity, { project: resolvedProjectId }),
            });
            await em.persistAndFlush(chat);
        }

        const message = em.create(ChatMessageEntity, {
            content,
            role,
            chat,
            metadata: metadata ?? null,
        });
        await em.persistAndFlush(message);

        const dto: ChatMessageDto = wrap(message).toJSON();
        return dto;
    });

    if (!result) return chatNotFound();

    return NextResponse.json(result, { status: 201 });
}

/**
 * Get a single message by ID (ownership verified through chat).
 */
export async function handleGetMessage(
    chatId: string,
    messageId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const message = await em
        .createQueryBuilder(ChatMessageEntity, 'm')
        .select('m.*')
        .leftJoinAndSelect('m.chat', 'c')
        .leftJoin('c.project', 'p')
        .where({
            'm.id': messageId,
            'c.id': chatId,
            $or: [{ 'c.user': user.id }, { 'p.user': user.id }],
        })
        .getSingleResult();

    if (!message) {
        return NextResponse.json({ error: 'Message not found', code: 'MESSAGE_NOT_FOUND' }, { status: 404 });
    }

    const dto: ChatMessageDto = wrap(message).toJSON();
    return NextResponse.json(dto);
}

// ---------------------------------------------------------------------------
// Chat artifact handlers
// ---------------------------------------------------------------------------

/**
 * List artifacts associated with a chat (paginated).
 */
export async function handleListChatArtifacts(
    req: NextRequest,
    chatId: string,
    user: UserEntity,
    projectId?: string,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const chat = await verifyChatAccess(em, chatId, user.id, projectId);
    if (!chat) return chatNotFound();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListArtifactsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const qb = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.versions', 'v')
        .leftJoinAndSelect('a.current_version', 'cv');

    if (projectId) {
        qb.leftJoin('a.project', 'p')
            .where({
                'v.chat': chatId,
                'p.id': projectId,
                'p.user': user.id,
                $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }],
            });
    } else {
        qb.where({
            'v.chat': chatId,
            $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }],
        });
    }

    const query = qb.groupBy(['a.id', 'cv.id']).orderBy({ 'a.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(query, {
        page: queryData.page ?? 1,
        perPage: queryData.limit ?? 20,
    });

    const mappedNodes = nodes.map((artifact: ArtifactEntity) => wrap(artifact).toJSON());

    return NextResponse.json(
        createPaginatedResponse(mappedNodes, totalCount, queryData.page ?? 1, queryData.limit ?? 20),
    );
}

/**
 * Get a single artifact associated with a chat.
 */
export async function handleGetChatArtifact(
    chatId: string,
    artifactId: string,
    user: UserEntity,
    projectId?: string,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const chat = await verifyChatAccess(em, chatId, user.id, projectId);
    if (!chat) return chatNotFound();

    const qb = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoinAndSelect('a.current_version', 'cv')
        .leftJoin('a.versions', 'v');

    if (projectId) {
        qb.leftJoin('a.project', 'p')
            .where({ 'a.id': artifactId, 'v.chat': chatId, 'p.id': projectId, 'p.user': user.id });
    } else {
        qb.where({ 'a.id': artifactId, 'v.chat': chatId });
    }

    const artifact = await qb.getSingleResult();

    if (!artifact) {
        return NextResponse.json({ error: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json(wrap(artifact).toJSON());
}
