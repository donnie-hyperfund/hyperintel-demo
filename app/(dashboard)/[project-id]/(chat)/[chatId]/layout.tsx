import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getChatPageData } from '@/lib/api/server/page-data';
import { formatPhaseTitle } from '@/lib/metadata/page-title';
import { ChatStateSeed } from '../_components/chat-state-seed';

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

    return (
        <>
            <ChatStateSeed
                chatId={chatId}
                chat={{
                    name: chat.name,
                    phaseIndex: chat.phase_index,
                    tokenUsage: chat.token_usage,
                    totalCost: chat.total_cost,
                    hasPendingChanges: chat.has_pending_changes,
                    completionBriefStatus: chat.completion_brief_status,
                }}
            />
            {children}
        </>
    );
}
