import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getIntakeChatPageData } from '@/lib/api/server/page-data';

export const metadata: Metadata = {
    title: 'Stakeholder chat',
};

type StakeholderChatLayoutProps = LayoutProps<'/stakeholders/[chatId]'>;

export default async function StakeholderChatLayout({ children, params }: StakeholderChatLayoutProps) {
    const { chatId } = await params;
    const { chat } = await getIntakeChatPageData(chatId, 'hpf');
    if (!chat) notFound();

    return children;
}
