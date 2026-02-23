import { redirect } from 'next/navigation';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { getOrm } from '@/lib/orm/orm';
import { NewPhaseChat } from './_components/new-phase-chat';

type ChatPageProps = {
    params: Promise<{ 'project-id': string }>;
    searchParams: Promise<{ new?: string }>;
};

export default async function ChatPage({ params, searchParams }: ChatPageProps) {
    const { 'project-id': projectId } = await params;
    const sp = await searchParams;

    if (!sp.new) {
        const { em } = await getOrm();
        const lastChat = await em.findOne(ChatEntity, { project: projectId }, { orderBy: { phase_index: 'desc' } });

        if (lastChat) {
            redirect(`/${projectId}/${lastChat.id}`);
        }
    }

    return <NewPhaseChat projectId={projectId} />;
}
