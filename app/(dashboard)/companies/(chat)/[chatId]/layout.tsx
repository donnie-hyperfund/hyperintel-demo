import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getIntakeChatPageData } from '@/lib/api/server/page-data';

export const metadata: Metadata = {
    title: 'Company chat',
};

type CompanyChatLayoutProps = LayoutProps<'/companies/[chatId]'>;

export default async function CompanyChatLayout({ children, params }: CompanyChatLayoutProps) {
    const { chatId } = await params;
    const { chat } = await getIntakeChatPageData(chatId, 'cpf');
    if (!chat) notFound();

    return children;
}
