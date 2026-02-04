import { sql, wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { type ChatDocumentSummaryDto, type ChatDto } from '@/lib/schema/message';
import { CHAT_ERRORS } from '../errors';

async function handleGetChat(
    req: NextRequest,
    projectId: string,
    chatId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const chat = await em
        .createQueryBuilder(ChatEntity, 'c')
        .select('c.*')
        .addSelect(sql`COUNT(DISTINCT m.id) as message_count`)
        .addSelect(sql`(
            SELECT m2.content 
            FROM chat_messages m2 
            WHERE m2.chat_id = c.id 
            ORDER BY m2.created_at ASC 
            LIMIT 1
        ) as first_message_content`)
        .leftJoin('c.project', 'p')
        .leftJoin('c.messages', 'm')
        .where({
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .groupBy(['c.id'])
        .getSingleResult();

    if (!chat) {
        return CHAT_ERRORS.CHAT_NOT_FOUND;
    }

    if (chat.message_count) {
        chat.message_count = Number(chat.message_count);
    }

    // Find all artifacts belonging to this chat
    const artifacts = await em.find(
        ArtifactEntity,
        { chat: chatId },
        { populate: ['current_version', 'versions'] },
    );

    // Build document summaries
    const documents: ChatDocumentSummaryDto[] = artifacts.map((artifact) => {
        const currentVersion = artifact.current_version;
        // Get the newest version number from all versions
        const newestVersion = artifact.versions.getItems().reduce((max, v) => Math.max(max, v.version), 0);
        // Get the status of the newest version
        const newestVersionEntity = artifact.versions.getItems().find((v) => v.version === newestVersion);
        return {
            id: artifact.id,
            key: artifact.key,
            title: artifact.title,
            current_version: currentVersion?.version ?? null,
            newest_version: newestVersion,
            status: newestVersionEntity?.status ?? 'approved',
            created_at: newestVersionEntity?.created_at ?? artifact.created_at,
            updated_at: artifact.updated_at,
        };
    });

    // Compute has_pending_changes - true if any version across all artifacts is in 'proposed' status
    const hasPendingChanges = artifacts.some((artifact) =>
        artifact.versions.getItems().some((v) => v.status === 'proposed'),
    );

    const dto: ChatDto = {
        ...(wrap(chat).toJSON() as ChatDto),
        documents,
        has_pending_changes: hasPendingChanges,
    };
    return NextResponse.json(dto);
}

async function handleDeleteChat(
    req: NextRequest,
    projectId: string,
    chatId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const chat = await em
        .createQueryBuilder(ChatEntity, 'c')
        .select('c.*')
        .leftJoin('c.project', 'p')
        .where({
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id,
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
