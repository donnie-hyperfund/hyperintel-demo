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

import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { sql, wrap } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { type NextRequest, NextResponse } from 'next/server';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { workerSystemAction } from '@/lib/broadcast/worker-internal';
import { IS_DEV } from '@/lib/config';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { getAvailablePresets } from '@/lib/presets';
import { ListArtifactsQuerySchema } from '@/lib/schema/artifact';
import { CreateUnifiedChatBodySchema, UpdateChatModelSchema, UpdateChatNameSchema } from '@/lib/schema/chat';
import {
    type ChatDocumentSummaryDto,
    type ChatDto,
    type ChatMessageDto,
    CreateMessageBodySchema,
    ListChatsQuerySchema,
    ListMessagesQuerySchema,
} from '@/lib/schema/message';
import { createR2Client, getR2CredentialsFromEnv } from '@/lib/vendor/r2';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chatNotFound() {
    return NextResponse.json({ error: 'Chat not found', code: 'CHAT_NOT_FOUND' }, { status: 404 });
}

/** Apply ownership WHERE clause to a query builder that already has `c` (chat) and `p` (project) aliases. */
function applyOwnership(qb: { where: (...args: any[]) => any }, chatId: string, userId: string, projectId?: string) {
    if (projectId) {
        qb.where({ 'c.id': chatId, 'p.id': projectId, 'p.user': userId, 'p.archived_at': null });
    } else {
        qb.where({ 'c.id': chatId, $or: [{ 'c.user': userId }, { 'p.user': userId, 'p.archived_at': null }] });
    }
}

/**
 * Verify user has access to a chat.
 */
export function verifyChatAccess(
    em: EntityManager,
    chatId: string,
    userId: string,
    projectId?: string,
): Promise<ChatEntity | null> {
    const qb = em.createQueryBuilder(ChatEntity, 'c').select('c.*').leftJoin('c.project', 'p');

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
        const project = await em.findOne(ProjectEntity, { id: projectId, user: user.id, archived_at: null });
        if (!project) {
            return NextResponse.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, { status: 404 });
        }

        const phaseIndex = await em.count(ChatEntity, { project: projectId });
        const chat = em.create(ChatEntity, {
            project: projectId,
            user,
            phase: 'active',
            phase_index: phaseIndex,
            ...(title && { summary: title }),
            ...(project.preferred_model && { selected_model: project.preferred_model }),
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
        phase_index: 0,
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
export async function handleGetChat(chatId: string, user: UserEntity, projectId?: string): Promise<NextResponse> {
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
 * Image files in R2 are best-effort deleted; orphans are cleaned up by the scheduled cleanup job.
 */
export async function handleDeleteChat(chatId: string, user: UserEntity, projectId?: string): Promise<NextResponse> {
    const { em } = await getOrm();

    const chat = await verifyChatAccess(em, chatId, user.id, projectId);
    if (!chat) return chatNotFound();

    // Collect image file storage keys before delete (FK will set null on cascade)
    const imageFiles = await em.find(ChatMessageFileEntity, { chat_id: chatId });
    const storageKeys = imageFiles.map((f) => f.storage_key);

    await em.removeAndFlush(chat);

    // Best-effort R2 cleanup — failures are silent, cleanup job handles orphans
    if (storageKeys.length > 0) {
        try {
            const creds = getR2CredentialsFromEnv();
            if (creds) {
                const s3 = createR2Client(creds);
                const bucket = IS_DEV ? 'hi-user-images-dev' : 'hi-user-images';
                await Promise.allSettled(
                    storageKeys.map((key) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))),
                );
            }
        } catch {
            // Silent — cleanup job will handle orphaned bucket objects
        }
    }

    return NextResponse.json({ message: 'Chat deleted successfully' });
}

/**
 * Update a chat's name.
 */
export async function handleUpdateChatName(req: NextRequest, chatId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const body = await req.json();
    const parsed = validatePayload(UpdateChatNameSchema, body);
    if (parsed instanceof NextResponse) return parsed;

    const chat = await verifyChatAccess(em, chatId, user.id);
    if (!chat) return chatNotFound();

    chat.name = parsed.name;
    await em.flush();

    return NextResponse.json({ name: parsed.name });
}

/**
 * Update a chat's selected model preset.
 */
export async function handleUpdateChatModel(req: NextRequest, chatId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const body = await req.json();
    const parsed = validatePayload(UpdateChatModelSchema.omit({ chatId: true }), body);
    if (parsed instanceof NextResponse) return parsed;

    // Validate preset exists and is allowed by env filtering
    const available = getAvailablePresets(process.env.ALLOWED_PRESETS, process.env.BLOCKED_PRESETS);
    if (!available.some((p) => p.id === parsed.model)) {
        return NextResponse.json(
            { error: `Preset '${parsed.model}' is not available`, code: 'INVALID_PRESET' },
            { status: 400 },
        );
    }

    const chat = await verifyChatAccess(em, chatId, user.id);
    if (!chat) return chatNotFound();

    chat.selected_model = parsed.model;

    // Propagate model preference to project for new-chat defaults
    const projectRef = chat.project;
    if (projectRef) {
        const project = await em.findOne(ProjectEntity, projectRef.id);
        if (project) project.preferred_model = parsed.model;
    }

    await em.flush();

    workerSystemAction(user.clerkId!, `chat:${chatId}`, 'modelChanged', {
        identifier: chatId,
        model: parsed.model,
    });

    return NextResponse.json({ selected_model: parsed.model });
}

// ---------------------------------------------------------------------------
// Chat list handler
// ---------------------------------------------------------------------------

/**
 * List chats (paginated) with message count and first message preview.
 */
export async function handleListChats(req: NextRequest, user: UserEntity, projectId?: string): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListChatsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        type: searchParams.get('type') ?? undefined,
        projectId: searchParams.get('projectId') ?? undefined,
        framework: searchParams.get('framework') ?? undefined,
        incomplete: searchParams.get('incomplete') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const { type, projectId: filterProjectId, framework, incomplete } = queryData;
    const page = queryData.page ?? 1;
    const perPage = queryData.limit ?? 20;

    // Shared filter builder — applies ownership + query filters to any chat query builder
    // biome-ignore lint/suspicious/noExplicitAny: MikroORM QB generics vary by select/join shape
    function applyFilters(qb: any) {
        if (projectId) {
            qb.where({ 'p.id': projectId, 'p.user': user.id, 'p.archived_at': null });
        } else {
            qb.where({ $or: [{ 'c.user': user.id }, { 'p.user': user.id, 'p.archived_at': null }] });
        }
        if (type) qb.andWhere({ 'c.type': type });
        if (filterProjectId) qb.andWhere({ 'c.project': filterProjectId });
        if (framework) qb.andWhere(sql`c.metadata->>'framework' = ${framework}`);
        if (incomplete) {
            qb.andWhere(sql`EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.chat_id = c.id)`);
            qb.andWhere(sql`NOT EXISTS (
                SELECT 1 FROM artifact_versions av
                WHERE av.chat_id = c.id AND av.status = 'approved'
            )`);
        }
    }

    // Count query — separate from data query to avoid GROUP BY miscounting
    const countQb = em.createQueryBuilder(ChatEntity, 'c').select('c.id').leftJoin('c.project', 'p');
    applyFilters(countQb);
    const totalCount = await countQb.getCount();

    // Data query — with aggregations and GROUP BY
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

    applyFilters(qb);

    qb.groupBy(['c.id'])
        .orderBy(projectId ? { 'c.phase_index': 'ASC' } : { 'c.created_at': 'DESC' })
        .limit(perPage)
        .offset((page - 1) * perPage);

    const nodes = await qb.getResult();

    const mappedNodes = nodes.map((chat: any): ChatDto => {
        const chatEntity = chat as ChatEntity;
        chatEntity.message_count = parseInt(chat.message_count) || 0;
        chatEntity.first_message_content = chat.first_message_content || null;
        return wrap(chatEntity).toJSON();
    });

    return NextResponse.json(createPaginatedResponse(mappedNodes, totalCount, page, perPage));
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

            const project = await em.findOne(ProjectEntity, {
                id: resolvedProjectId,
                user: { id: user.id },
                archived_at: null,
            });
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
export async function handleGetMessage(chatId: string, messageId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const message = await em
        .createQueryBuilder(ChatMessageEntity, 'm')
        .select('m.*')
        .leftJoinAndSelect('m.chat', 'c')
        .leftJoin('c.project', 'p')
        .where({
            'm.id': messageId,
            'c.id': chatId,
            $or: [{ 'c.user': user.id }, { 'p.user': user.id, 'p.archived_at': null }],
        })
        .getSingleResult();

    if (!message) {
        return NextResponse.json({ error: 'Message not found', code: 'MESSAGE_NOT_FOUND' }, { status: 404 });
    }

    const dto: ChatMessageDto = wrap(message).toJSON();
    return NextResponse.json(dto);
}

// ---------------------------------------------------------------------------
// Dev-only: Message feedback
// ---------------------------------------------------------------------------

export async function handleSetMessageFeedback(
    chatId: string,
    messageId: string,
    user: UserEntity,
    body: { feedback_score: boolean | null; feedback?: string | null },
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

    wrap(message).assign({
        feedback_score: body.feedback_score,
        feedback: body.feedback ?? null,
    });
    await em.flush();

    return NextResponse.json({ ok: true });
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
        document_type: searchParams.get('document_type') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const qb = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.versions', 'v')
        .leftJoinAndSelect('a.current_version', 'cv');

    const versionFilter: Record<string, unknown> = { 'v.chat': chatId };
    if (queryData.document_type) {
        versionFilter['v.document_type'] = queryData.document_type;
    }

    if (projectId) {
        qb.leftJoin('a.project', 'p').where({
            ...versionFilter,
            'p.id': projectId,
            'p.user': user.id,
            'p.archived_at': null,
            $or: [{ 'cv.status': null }, { 'cv.status': { $ne: 'deleted' } }],
        });
    } else {
        qb.where({
            ...versionFilter,
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
        qb.leftJoin('a.project', 'p').where({
            'a.id': artifactId,
            'v.chat': chatId,
            'p.id': projectId,
            'p.user': user.id,
            'p.archived_at': null,
        });
    } else {
        qb.where({ 'a.id': artifactId, 'v.chat': chatId });
    }

    const artifact = await qb.getSingleResult();

    if (!artifact) {
        return NextResponse.json({ error: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json(wrap(artifact).toJSON());
}
