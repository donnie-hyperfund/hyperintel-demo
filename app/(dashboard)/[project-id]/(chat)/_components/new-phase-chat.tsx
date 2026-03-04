'use client';

import { useEffect, useState } from 'react';
import { ChatModule } from '@/modules/chat/providers/chat-module';
import PhaseChatInterface from './phase-chat-interface';

type NewPhaseChatProps = {
    projectId: string;
};

export function NewPhaseChat({ projectId }: NewPhaseChatProps) {
    const [mountKey, setMountKey] = useState(0);

    useEffect(() => {
        const handleNewPhase = () => setMountKey((k) => k + 1);
        window.addEventListener('new-phase', handleNewPhase);
        return () => window.removeEventListener('new-phase', handleNewPhase);
    }, []);

    return (
        <ChatModule key={mountKey} projectId={projectId}>
            <PhaseChatInterface />
        </ChatModule>
    );
}
