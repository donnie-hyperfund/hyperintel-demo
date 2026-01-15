import { type NextRequest, NextResponse } from 'next/server';
import { wrap } from '@mikro-orm/core';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { getPaginatedResult, createPaginatedResponse } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { ListChatsQuerySchema, type ChatDto } from '@/lib/schema/message';

async function handleGetChats(
    req: NextRequest,
    projectId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListChatsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    const query = em.createQueryBuilder(ChatEntity, 'c')
        .select([
            'c',
            'COUNT(DISTINCT m.id) as message_count',
            `(
                SELECT m2.content 
                FROM chat_messages m2 
                WHERE m2.chat_id = c.id 
                ORDER BY m2.created_at ASC 
                LIMIT 1
            ) as first_message_content`,
        ])
        .leftJoin('c.project', 'p')
        .leftJoin('c.messages', 'm')
        .where({ 
            'p.id': projectId,
            'p.user': user.id 
        })
        .groupBy(['c.id'])
        .orderBy({ 'c.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(
        query,
        {
            page: queryData.page ?? 1,
            perPage: queryData.limit ?? 20,
        },
    );

    const mappedNodes = nodes.map((chat: any): ChatDto => {
        const chatEntity = chat as ChatEntity;
        chatEntity.message_count = parseInt(chat.message_count) || 0;
        chatEntity.first_message_content = chat.first_message_content || null;
        return wrap(chatEntity).toJSON();
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

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return await handleGetChats(request, projectId, user);
    })(req);
}

