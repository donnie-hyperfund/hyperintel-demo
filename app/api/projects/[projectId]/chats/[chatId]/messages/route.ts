import { type NextRequest, NextResponse } from 'next/server';
import { wrap } from '@mikro-orm/core';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { getPaginatedResult, createPaginatedResponse } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { ListMessagesQuerySchema, CreateMessageBodySchema, type ChatMessageDto } from '@/lib/schema/message';
import { CHAT_ERRORS } from '../../errors';

async function handleGetMessages(
    req: NextRequest,
    projectId: string,
    chatId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListMessagesQuerySchema, {
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
        role: searchParams.get('role'),
    });

    if (queryData instanceof NextResponse) return queryData;

    const query = em.createQueryBuilder(ChatMessageEntity, 'm')
        .select('m.*')
        .leftJoin('m.chat', 'c')
        .leftJoin('c.project', 'p')
        .where({
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .orderBy({ 'm.created_at': 'ASC' });

    if (queryData.role) {
        query.andWhere({ 'm.role': queryData.role });
    }

    const { nodes, totalCount } = await getPaginatedResult(
        query,
        {
            page: queryData.page ?? 1,
            perPage: queryData.limit ?? 20,
        },
    );

    const mappedNodes = nodes.map((message: ChatMessageEntity): ChatMessageDto => {
        return wrap(message).toJSON();
    });

    return NextResponse.json(
        createPaginatedResponse(
            mappedNodes,
            totalCount,
            queryData.page ?? 1,
            queryData.limit ?? 20,
        ),
    );
}

async function handleCreateMessage(
    req: NextRequest,
    projectId: string,
    chatId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const body = await req.json();
    const bodyData = validatePayload(CreateMessageBodySchema, body);

    if (bodyData instanceof NextResponse) return bodyData;

    const { content, role, metadata } = bodyData;

    const result = await em.transactional(async (em) => {
        let chat = await em.createQueryBuilder(ChatEntity, 'c')
            .select('c.*')
            .leftJoin('c.project', 'p')
            .where({
                'c.id': chatId,
                'p.id': projectId,
                'p.user': user.id,
            })
            .getSingleResult();

        if (!chat) {
            const project = await em.findOne(ProjectEntity, { 
                id: projectId, 
                user: { id: user.id } 
            });

            if (!project) {
                return null;
            }

        chat = em.create(ChatEntity, {
            id: chatId,
            project,
            phase: 'chat',
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

    if (!result) {
        return CHAT_ERRORS.PROJECT_NOT_FOUND;
    }

    return NextResponse.json(result, { status: 201 });
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, chatId } = await params;
        return await handleGetMessages(request, projectId, chatId, user);
    })(req);
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, chatId } = await params;
        return await handleCreateMessage(request, projectId, chatId, user);
    })(req);
}

