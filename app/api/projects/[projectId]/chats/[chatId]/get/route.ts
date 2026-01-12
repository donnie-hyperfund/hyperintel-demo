import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { CHAT_ERRORS } from '../../errors';
import type { ChatResponseDto } from '../../schemas';

async function handleGetChat(
    req: NextRequest,
    projectId: string,
    chatId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const chatData = await em.createQueryBuilder(ChatEntity, 'c')
        .select([
            'c.*',
            'p.id as project_id',
            'COUNT(DISTINCT m.id) as message_count',
            `(
                SELECT m2.content 
                FROM messages m2 
                WHERE m2.chat_id = c.id 
                ORDER BY m2.created_at ASC 
                LIMIT 1
            ) as first_message_content`,
        ])
        .leftJoin('c.project', 'p')
        .leftJoin('c.messages', 'm')
        .where({ 
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id 
        })
        .groupBy(['c.id', 'p.id'])
        .execute<any>('get');

    if (!chatData) {
        return CHAT_ERRORS.CHAT_NOT_FOUND;
    }

    const response: ChatResponseDto = {
        id: chatData.id,
        name: chatData.first_message_content || '',
        projectId: chatData.project_id,
        messageCount: Number.parseInt(chatData.message_count, 10),
        firstMessageContent: chatData.first_message_content || null,
        createdAt: new Date(chatData.created_at).toISOString(),
        updatedAt: new Date(chatData.updated_at).toISOString(),
    };

    return NextResponse.json(response);
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, chatId } = await params;
        return await handleGetChat(request, projectId, chatId, user);
    })(req);
}
