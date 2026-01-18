'use client';

import { useParams } from 'next/navigation';
import ChatInterface from './_components/chat-interface';

export default function Page() {
    const params = useParams();
    const projectId = params?.['project-id'] as string;

    // Render ChatInterface without chatId - it will create one on first message
    return <ChatInterface projectId={projectId} />;
}
