import 'server-only';

import { sql, wrap } from '@mikro-orm/core';
import { createPaginatedResponse } from '@/lib/api/pagination';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import type { ChatDocumentSummaryDto, ChatDto } from '@/lib/schema/message';
import type { PaginatedResponse, PaginationParams } from '../../client/types';

export async function fetchChats(
    projectId: string,
    user: UserEntity,
    params?: PaginationParams,
): Promise<PaginatedResponse<ChatDto>> {
    const { em } = await getOrm();

    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;

    const totalCount = await em
        .createQueryBuilder(ChatEntity, 'c')
        .leftJoin('c.project', 'p')
        .where({ 'p.id': projectId, 'p.user': user.id })
        .getCount();

    const nodes = await em
        .createQueryBuilder(ChatEntity, 'c')
        .select('c.*')
        .addSelect(sql`COUNT(DISTINCT m.id) as message_count`)
        .addSelect(
            sql`(
            SELECT m2.content
            FROM chat_messages m2
            WHERE m2.chat_id = c.id
            ORDER BY m2.created_at ASC
            LIMIT 1
        ) as first_message_content`,
        )
        .leftJoin('c.project', 'p')
        .leftJoin('c.messages', 'm')
        .where({
            'p.id': projectId,
            'p.user': user.id,
        })
        .groupBy(['c.id'])
        .orderBy({ 'c.phase_index': 'ASC' })
        .limit(limit)
        .offset((page - 1) * limit)
        .getResultList();

    const mappedNodes = nodes.map((chat: any): ChatDto => {
        const chatEntity = chat as ChatEntity;
        chatEntity.message_count = parseInt(chat.message_count) || 0;
        chatEntity.first_message_content = chat.first_message_content || null;
        return wrap(chatEntity).toJSON();
    });

    return createPaginatedResponse(mappedNodes, totalCount, page, limit);
}

export async function fetchChat(projectId: string, chatId: string, user: UserEntity): Promise<ChatDto | null> {
    const { em } = await getOrm();

    const chat = await em
        .createQueryBuilder(ChatEntity, 'c')
        .select('c.*')
        .addSelect(sql`COUNT(DISTINCT m.id) as message_count`)
        .addSelect(
            sql`(
            SELECT m2.content
            FROM chat_messages m2
            WHERE m2.chat_id = c.id
            ORDER BY m2.created_at ASC
            LIMIT 1
        ) as first_message_content`,
        )
        .leftJoin('c.project', 'p')
        .leftJoin('c.messages', 'm')
        .where({
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .groupBy(['c.id'])
        .getSingleResult();

    if (!chat) return null;

    if (chat.message_count) {
        chat.message_count = Number(chat.message_count);
    }

    const artifacts = await em.find(
        ArtifactEntity,
        { versions: { chat: chatId } },
        { populate: ['current_version', 'versions'] },
    );

    const documents: ChatDocumentSummaryDto[] = artifacts.map((artifact) => {
        const currentVersion = artifact.current_version;
        const versions = artifact.versions.getItems();
        const newestVersion = versions.reduce((max, v) => Math.max(max, v.version), 0);
        const newestVersionEntity = versions.find((v) => v.version === newestVersion);
        const proposedVersion = versions.find((v) => v.status === 'proposed');
        return {
            id: artifact.id,
            key: artifact.key,
            title: proposedVersion?.title ?? currentVersion?.title ?? '',
            current_version: currentVersion?.version ?? null,
            newest_version: newestVersion,
            status: newestVersionEntity?.status ?? 'approved',
            created_at: newestVersionEntity?.created_at ?? artifact.created_at,
            updated_at: artifact.updated_at,
        };
    });

    const hasPendingChanges = artifacts.some((artifact) =>
        artifact.versions.getItems().some((v) => v.status === 'proposed'),
    );

    return {
        ...(wrap(chat).toJSON() as ChatDto),
        documents,
        has_pending_changes: hasPendingChanges,
    };
}
