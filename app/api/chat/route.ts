import { NextResponse } from 'next/server';
import { assertClerkAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const clerkUser = await assertClerkAuth();
        const { em } = await getOrm();

        // Find user by Clerk ID
        let user = await em.findOne(UserEntity, { clerkId: clerkUser.userId });
        if (!user) {
            user = em.create(UserEntity, {
                clerkId: clerkUser.userId,
                email: `${clerkUser.userId}@placeholder.com`,
                emailConfirmed: false,
            });
            await em.persistAndFlush(user);
        }
        const userId = user.id;

        // Find or create project
        let project = await em.findOne(ProjectEntity, { user: userId });
        if (!project) {
            project = em.create(ProjectEntity, {
                name: 'Default Project',
                user,
            });
            await em.persistAndFlush(project);
        }
        const projectId = project.id;

        // Find or create chat
        let chat = await em.findOne(ChatEntity, { project: projectId });
        if (!chat) {
            chat = em.create(ChatEntity, {
                phase: 'discovery',
                project,
                phase_index: await em.count(ChatEntity, { project: projectId }),
            });
            await em.persistAndFlush(chat);
        }
        const chatId = chat.id;

        // Load messages
        const messages = await em.find(ChatMessageEntity, { chat: chatId }, { orderBy: { created_at: 'ASC' } });

        // Return only plain data - no entity references
        return NextResponse.json({
            chatId,
            projectId,
            messages: messages.map((m) => m.toJSON()),
        });
    } catch (error) {
        console.error('Error fetching chat:', error);
        if (error && typeof error === 'object' && 'name' in error && error.name === 'UNAUTHORIZED') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
