import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { MessageEntity } from '@/lib/orm/entities/chats/message.entity';
import { MESSAGE_ERRORS } from '../../../../errors';
import type { MessageResponseDto } from '../../../../schemas';

async function handleGetMessage(
    req: NextRequest,
    projectId: string,
    chatId: string,
    messageId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const messageData = await em.createQueryBuilder(MessageEntity, 'm')
        .select('m.*')
        .leftJoin('m.chat', 'c')
        .leftJoin('c.project', 'p')
        .where({
            'm.id': messageId,
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .execute<any>('get');

    if (!messageData) {
        return MESSAGE_ERRORS.MESSAGE_NOT_FOUND;
    }

    const response: MessageResponseDto = {
        id: messageData.id,
        content: messageData.content,
        authorType: messageData.author_type,
        chatId: messageData.chat_id,
        metadata: messageData.metadata || null,
        createdAt: new Date(messageData.created_at).toISOString(),
        updatedAt: new Date(messageData.updated_at).toISOString(),
    };

    return NextResponse.json(response);
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string; messageId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, chatId, messageId } = await params;
        return await handleGetMessage(request, projectId, chatId, messageId, user);
    })(req);
}
