import { ChatModule } from '@/modules/chat/providers/chat-module';
import ChatInterface from './_components/chat-interface';

type ChatPageProps = {
    params: Promise<{ 'project-id': string }>;
};

export default async function ChatPage({ params }: ChatPageProps) {
    const { 'project-id': projectId } = await params;

    // Render ChatInterface without chatId - it will create one on first message
    return (
        <ChatModule projectId={projectId}>
            <ChatInterface />
        </ChatModule>
    );
}
