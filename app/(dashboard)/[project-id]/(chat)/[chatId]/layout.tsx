import camelcaseKeys from 'camelcase-keys';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SWRConfig, unstable_serialize } from 'swr';
import { chatKeys } from '@/lib/api/client/fetchers/chats';
import { getChatPageData } from '@/lib/api/server/page-data';
import { formatPhaseTitle } from '@/lib/metadata/page-title';

type ChatLayoutProps = LayoutProps<'/[project-id]/[chatId]'>;

export async function generateMetadata({ params }: ChatLayoutProps): Promise<Metadata> {
    const { 'project-id': projectId, chatId } = await params;
    const { project, chat } = await getChatPageData(projectId, chatId);

    if (!project || !chat) return {};

    return {
        title: formatPhaseTitle(project.name, chat),
    };
}

export default async function ChatLayout({ children, params }: ChatLayoutProps) {
    const { 'project-id': projectId, chatId } = await params;
    const { chat } = await getChatPageData(projectId, chatId);

    if (!chat) notFound();

    const fallback: Record<string, unknown> = {
        [unstable_serialize(chatKeys.detail(chatId))]: camelcaseKeys(chat, { deep: true }),
    };

    return <SWRConfig value={{ fallback }}>{children}</SWRConfig>;
}
