import { ChatModule } from '@/modules/chat/providers/chat-module';
import PhaseChatInterface from '../_components/phase-chat-interface';

type ChatPageProps = PageProps<'/[project-id]/[chatId]'>;

export default async function ChatPage({ params }: ChatPageProps) {
    const { chatId, 'project-id': projectId } = await params;

    return (
        <ChatModule key={chatId} projectId={projectId} initialChatId={chatId}>
            <PhaseChatInterface />
        </ChatModule>
    );
}
