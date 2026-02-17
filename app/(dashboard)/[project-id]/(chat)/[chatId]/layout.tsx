import { SWRConfig, unstable_serialize } from 'swr';
import { assertAuth } from '@/lib/api/auth-guard';
import { chatKeys } from '@/lib/api/client/fetchers/chats';
import { fetchChat } from '@/lib/api/server/fetchers/chats';

interface ChatLayoutProps {
    children: React.ReactNode;
    params: Promise<{ 'project-id': string; chatId: string }>;
}

export default async function ChatLayout({ children, params }: ChatLayoutProps) {
    const { 'project-id': projectId, chatId } = await params;
    const user = await assertAuth();

    const chat = await fetchChat(projectId, chatId, user);

    const fallback: Record<string, unknown> = {};

    if (chat) {
        fallback[unstable_serialize(chatKeys.detail(projectId, chatId))] = chat;
    }

    return <SWRConfig value={{ fallback }}>{children}</SWRConfig>;
}
