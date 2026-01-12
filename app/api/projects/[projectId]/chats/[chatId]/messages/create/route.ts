import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { validatePayload } from '@/lib/api/validation';
import { CreateMessageBodySchema, type MessageResponseDto } from '../../../schemas';
import { CHAT_ERRORS } from '../../../errors';

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

    const { content, authorType, metadata } = bodyData;

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
            role: authorType,
            chat,
            metadata: metadata ?? null,
        });

        await em.persistAndFlush(message);

        return {
            id: message.id,
            content: message.content,
            authorType: message.role,
            chatId: chat.id,
            metadata: message.metadata ?? null,
            createdAt: message.created_at.toISOString(),
        };
    });

    if (!result) {
        return CHAT_ERRORS.PROJECT_NOT_FOUND;
    }

    return NextResponse.json(result, { status: 201 });
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
