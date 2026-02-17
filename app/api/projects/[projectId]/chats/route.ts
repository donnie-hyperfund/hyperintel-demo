import { sql, wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { type ChatDto, CreateChatBodySchema, ListChatsQuerySchema } from '@/lib/schema/message';

async function handleGetChats(req: NextRequest, projectId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListChatsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const query = em
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
        .leftJoin('c.messages', 'm')
        .where({
            'p.id': projectId,
            'p.user': user.id,
        })
        .groupBy(['c.id'])
        .orderBy({ 'c.phase_index': 'ASC' });

    const { nodes, totalCount } = await getPaginatedResult(query, {
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

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return await handleGetChats(request, projectId, user);
    })(req);
}

async function handleCreateChat(req: NextRequest, projectId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const json = await req.json();
    const bodyData = validatePayload(CreateChatBodySchema, json);

    if (bodyData instanceof NextResponse) return bodyData;

    // Verify project exists and belongs to user
    const project = await em.findOne(ProjectEntity, {
        id: projectId,
        user: user.id,
    });

    if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Create chat
    const chat = em.create(ChatEntity, {
        project: projectId,
        phase: 'active',
        phase_index: await em.count(ChatEntity, { project: projectId }),
    });

    await em.persistAndFlush(chat);

    const chatDto: ChatDto = wrap(chat).toJSON();
    return NextResponse.json(chatDto, { status: 201 });
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return await handleCreateChat(request, projectId, user);
    })(req);
}
