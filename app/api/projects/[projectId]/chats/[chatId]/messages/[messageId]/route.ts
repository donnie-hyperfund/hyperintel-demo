import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { type ChatMessageDto } from '@/lib/schema/message';
import { MESSAGE_ERRORS } from '../../../errors';

async function handleGetMessage(
    req: NextRequest,
    projectId: string,
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
            'p.id': projectId,
            'p.user': user.id,
        })
        .getSingleResult();

    if (!message) {
        return MESSAGE_ERRORS.MESSAGE_NOT_FOUND;
    }

    const dto: ChatMessageDto = wrap(message).toJSON();
    return NextResponse.json(dto);
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
