import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { MessageEntity } from '@/lib/orm/entities/chats/message.entity';
import { getPaginatedResult, createPaginatedResponse } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { ListMessagesQuerySchema, type MessageResponseDto } from '../../../schemas';

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
        authorType: searchParams.get('authorType'),
    });

    if (queryData instanceof NextResponse) return queryData;

    const query = em.createQueryBuilder(MessageEntity, 'm')
        .select('m.*')
        .leftJoin('m.chat', 'c')
        .leftJoin('c.project', 'p')
        .where({
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .orderBy({ 'm.created_at': 'ASC' });

    if (queryData.authorType) {
        query.andWhere({ 'm.author_type': queryData.authorType });
    }

    const { nodes, totalCount } = await getPaginatedResult(
        query,
        {
            page: queryData.page ?? 1,
            perPage: queryData.limit ?? 20,
        },
    );

    const responseData: MessageResponseDto[] = nodes.map((msg: any) => ({
        id: msg.id,
        content: msg.content,
        authorType: msg.author_type,
        chatId: msg.chat_id,
        metadata: msg.metadata || null,
        createdAt: new Date(msg.created_at).toISOString(),
        updatedAt: new Date(msg.updated_at).toISOString(),
    }));

    return NextResponse.json(
        createPaginatedResponse(
            responseData,
            totalCount,
            queryData.page ?? 1,
            queryData.limit ?? 20,
        ),
    );
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
