import { SWRConfig, unstable_serialize } from 'swr';
import { assertAuthPage } from '@/lib/api/auth-guard';
import { chatKeys } from '@/lib/api/client/fetchers/chats';
import { fetchChat } from '@/lib/api/server/fetchers/chats';

type ChatLayoutProps = LayoutProps<'/[project-id]/[chatId]'>;

export default async function ChatLayout({ children, params }: ChatLayoutProps) {
    const { 'project-id': projectId, chatId } = await params;
    const user = await assertAuthPage();
    const chat = await fetchChat(projectId, chatId, user);

    const fallback: Record<string, unknown> = {};

    if (chat) {
        fallback[unstable_serialize(chatKeys.detail(chatId))] = chat;
    }

    return <SWRConfig value={{ fallback }}>{children}</SWRConfig>;
}
