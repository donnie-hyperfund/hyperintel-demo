import { type NextRequest, NextResponse } from 'next/server';
import { wrap } from '@mikro-orm/core';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { type ChatDto } from '@/lib/schema/message';
import { CHAT_ERRORS } from '../errors';

async function handleGetChat(
    req: NextRequest,
    projectId: string,
    chatId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const chatData = await em.createQueryBuilder(ChatEntity, 'c')
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
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id 
        })
        .groupBy(['c.id'])
        .execute<any>('get');

    if (!chatData) {
        return CHAT_ERRORS.CHAT_NOT_FOUND;
    }

    const chat = chatData as ChatEntity;
    chat.message_count = parseInt(chatData.message_count) || 0;
    chat.first_message_content = chatData.first_message_content || null;

    const dto: ChatDto = wrap(chat).toJSON();
    return NextResponse.json(dto);
}

async function handleDeleteChat(
    req: NextRequest,
    projectId: string,
    chatId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const chat = await em.createQueryBuilder(ChatEntity, 'c')
        .select('c.*')
        .leftJoin('c.project', 'p')
        .where({ 
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id 
        })
        .getSingleResult();

    if (!chat) {
        return CHAT_ERRORS.CHAT_NOT_FOUND;
    }

    await em.removeAndFlush(chat);

    return NextResponse.json({ message: 'Chat deleted successfully' }, { status: 200 });
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

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, chatId } = await params;
        return await handleDeleteChat(request, projectId, chatId, user);
    })(req);
}

