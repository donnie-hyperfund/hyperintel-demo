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
import { CreateUnifiedChatBodySchema } from '@/lib/schema/chat';
import type { ChatDto } from '@/lib/schema/message';

export function GET(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleListChats(request, user))(req);
}

async function handleCreateChat(req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const json = await req.json();
    const bodyData = validatePayload(CreateUnifiedChatBodySchema, json);

    if (bodyData instanceof NextResponse) return bodyData;

    const { projectId, framework, category, title } = bodyData;

    // Must specify either projectId (phase chat) or framework (intake chat)
    if (!projectId && !framework) {
        return NextResponse.json(
            { error: 'Either projectId or framework is required', code: 'BAD_REQUEST' },
            { status: 400 },
        );
    }

    // Validate: category required for hpf
    if (framework === 'hpf' && !category) {
        return NextResponse.json(
            { error: 'Category is required for Human Persona Framework', code: 'BAD_REQUEST' },
            { status: 400 },
        );
    }

    if (projectId) {
        // Project chat
        const project = await em.findOne(ProjectEntity, { id: projectId, user: user.id, archived_at: null });
        if (!project) {
            return NextResponse.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, { status: 404 });
        }

        const chat = em.create(ChatEntity, {
            project: projectId,
            user,
            phase: 'active',
            phase_index: await em.count(ChatEntity, { project: projectId }),
            ...(title && { summary: title }),
        });
        await em.persistAndFlush(chat);

        // Broadcast chat_created to all user WS connections (fire-and-forget)
        if (user.clerkId) {
            broadcastUserEvent(user.clerkId, 'chat_created', { chatId: chat.id, projectId }).catch(console.error);
        }

        const chatDto: ChatDto = wrap(chat).toJSON();
        return NextResponse.json(chatDto, { status: 201 });
    }

    // Intake chat
    const chat = em.create(ChatEntity, {
        type: 'intake',
        phase: 'active',
        phase_index: 0,
        user,
        metadata: {
            framework,
            ...(category && { category }),
        },
    });
    await em.persistAndFlush(chat);

    // Broadcast chat_created to all user WS connections (fire-and-forget)
    if (user.clerkId) {
        broadcastUserEvent(user.clerkId, 'chat_created', { chatId: chat.id }).catch(console.error);
    }

    const chatDto: ChatDto = wrap(chat).toJSON();
    return NextResponse.json(chatDto, { status: 201 });
}

export function POST(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleCreateChat(request, user))(req);
}
