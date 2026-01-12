import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { MessageEntity } from '@/lib/orm/entities/chats/message.entity';
import { MessageAuthorType } from '@/lib/orm/entities/chats/message-author-type.enum';
import { MESSAGE_ERRORS } from '../../../../errors';

async function handleDeleteMessage(
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
        return MESSAGE_ERRORS.CANNOT_DELETE_AI_MESSAGE;
    }

    await em.removeAndFlush(message);

    return NextResponse.json({ message: 'Message deleted successfully' }, { status: 200 });
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string; messageId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, chatId, messageId } = await params;
        return await handleDeleteMessage(request, projectId, chatId, messageId, user);
    })(req);
}
