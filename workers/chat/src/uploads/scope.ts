/**
 * Shared helpers for upload handlers — scope resolution + user lookup.
 * Used by both artifact and image pipelines (presign, confirm, associate).
 */

import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import type { Ctx } from '../context';

export interface ResolvedScope {
    project?: InstanceType<typeof ProjectEntity> | null;
    dbUserId: string;
}

/**
 * Resolve the upload scope + internal user ID from an authenticated request.
 *
 * - With `projectId`: validates user owns the (non-archived) project; optionally checks chat belongs to it.
 * - With `chatId` only: validates user owns the intake chat.
 * - With neither: staged upload — just resolves the internal user ID.
 */
export async function resolveScope(
    em: Ctx['em'],
    user: Ctx['user'],
    projectId?: string,
    chatId?: string,
): Promise<ResolvedScope> {
    let project: InstanceType<typeof ProjectEntity> | null = null;

    if (projectId) {
        project = await em.findOneOrFail(
            ProjectEntity,
            {
                id: projectId,
                user: { clerkId: user.userId },
                archived_at: null,
            },
            { populate: ['user'] },
        );
        if (chatId) {
            await em.findOneOrFail(ChatEntity, { id: chatId, project: projectId });
        }
        return { project, dbUserId: project.user.id };
    }

    if (chatId) {
        const chat = await em.findOneOrFail(
            ChatEntity,
            {
                id: chatId,
                type: 'intake',
                user: { clerkId: user.userId },
            },
            { populate: ['user'] },
        );
        return { dbUserId: chat.user!.id };
    }

    // Staged upload — no project or chat, resolve user directly
    const dbUser = await em.findOneOrFail(UserEntity, { clerkId: user.userId });
    return { dbUserId: dbUser.id };
}

/** Resolve just the internal user ID — used by handlers that don't need full scope. */
export async function resolveDbUserId(em: Ctx['em'], user: Ctx['user']): Promise<string> {
    const dbUser = await em.findOneOrFail(UserEntity, { clerkId: user.userId });
    return dbUser.id;
}

/**
 * Verify that the caller owns the chat referenced by `chatId`.
 * Handles both phase chats (owned via project.user) and intake chats (direct user FK).
 * Returns the internal userId for downstream use.
 */
export async function verifyChatOwnership(em: Ctx['em'], user: Ctx['user'], chatId: string): Promise<string> {
    const chat = await em.findOneOrFail(
        ChatEntity,
        {
            id: chatId,
            $or: [{ project: { user: { clerkId: user.userId } } }, { user: { clerkId: user.userId } }],
        },
        { populate: ['project.user', 'user'] },
    );
    return chat.user?.id ?? chat.project!.user.id;
}
