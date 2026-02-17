'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import ChatInterface from './_components/chat-interface';

export default function ChatPage() {
    const params = useParams();
    const projectId = params['project-id'] as string;
    const [mountKey, setMountKey] = useState(0);

    useEffect(() => {
        const handleNewPhase = () => setMountKey((k) => k + 1);
        window.addEventListener('new-phase', handleNewPhase);
        return () => window.removeEventListener('new-phase', handleNewPhase);
    }, []);

    return (
        <ChatModule key={mountKey} projectId={projectId}>
            <ChatInterface />
        </ChatModule>
    );
}
