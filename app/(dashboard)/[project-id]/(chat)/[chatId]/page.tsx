import { ChatModule } from '@/modules/chat/providers/chat-module';
import ChatInterface from '../_components/chat-interface';

type ChatPageProps = {
    params: Promise<{ 'project-id': string; chatId: string }>;
};

export default async function ChatPage({ params }: ChatPageProps) {
    const { chatId, 'project-id': projectId } = await params;

    return (
        <ChatModule key={chatId} projectId={projectId} initialChatId={chatId}>
            <ChatInterface />
        </ChatModule>
    );
}
