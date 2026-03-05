import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { validatePayload } from '@/lib/api/validation';
import { broadcastUserEvent } from '@/lib/broadcast/user-event';
import { handleListChats } from '@/lib/chats/handlers';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { CreateChatBodySchema } from '@/lib/schema/chat';
import type { ChatDto } from '@/lib/schema/message';

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

    // Broadcast chat_created to all user WS connections (fire-and-forget)
    if (user.clerkId) {
        broadcastUserEvent(user.clerkId, 'chat_created', { chatId: chat.id, projectId }).catch(console.error);
    }

    const chatDto: ChatDto = wrap(chat).toJSON();
    return NextResponse.json(chatDto, { status: 201 });
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return handleListChats(request, user, projectId);
    })(req);
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return handleCreateChat(request, projectId, user);
    })(req);
}
