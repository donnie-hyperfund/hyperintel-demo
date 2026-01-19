import { ChatModule } from '@/modules/chat/providers/chat-module';
import ChatInterface from '../../(chat)/_components/chat-interface';

interface ChatPageProps {
    params: Promise<{ 'project-id': string; chatId: string }>;
}

export default async function ChatPage({ params }: ChatPageProps) {
    const { chatId, 'project-id': projectId } = await params;

    return (
        <ChatModule>
            <ChatInterface chatId={chatId} projectId={projectId} />
        </ChatModule>
    );
}
