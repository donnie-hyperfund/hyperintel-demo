import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { MessageEntity } from '@/lib/orm/entities/chats/message.entity';
import { MessageAuthorType } from '@/lib/orm/entities/chats/message-author-type.enum';
import { validatePayload } from '@/lib/api/validation';
import { UpdateMessageBodySchema, type MessageResponseDto } from '../../../../schemas';
import { MESSAGE_ERRORS } from '../../../../errors';

async function handleUpdateMessage(
    req: NextRequest,
    projectId: string,
    chatId: string,
    messageId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const message = await em.createQueryBuilder(MessageEntity, 'm')
        .select('m.*')
        .leftJoin('m.chat', 'c')
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

    if (message.authorType === MessageAuthorType.AI) {
        return MESSAGE_ERRORS.CANNOT_MODIFY_AI_MESSAGE;
    }

    const body = await req.json();
    const bodyData = validatePayload(UpdateMessageBodySchema, body);

    if (bodyData instanceof NextResponse) return bodyData;

    message.content = bodyData.content;
    await em.persistAndFlush(message);

    const response: MessageResponseDto = {
        id: message.id,
        content: message.content,
        authorType: message.authorType,
        chatId: message.chat.id,
        metadata: message.metadata ?? null,
        createdAt: message.created_at.toISOString(),
        updatedAt: message.updated_at.toISOString(),
    };

    return NextResponse.json(response);
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string; messageId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, chatId, messageId } = await params;
        return await handleUpdateMessage(request, projectId, chatId, messageId, user);
    })(req);
}
