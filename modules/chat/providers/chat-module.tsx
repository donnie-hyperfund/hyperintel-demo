'use client';

import type { ReactNode } from 'react';
import type { Message } from '../types';
import { ArtifactProvider } from './artifact-provider';
import { ChatProvider } from './chat-provider';

type ChatModuleProps = {
    children: ReactNode;
    /** Project ID for API calls */
    projectId: string;
    /** Initial chat ID (optional) */
    initialChatId?: string;
    /** Initial messages to display */
    initialMessages?: Message[];
};

export function ChatModule({ children, projectId, initialChatId, initialMessages = [] }: ChatModuleProps) {
    return (
        <ArtifactProvider>
            <ChatProvider projectId={projectId} initialChatId={initialChatId} initialMessages={initialMessages}>
                {children}
            </ChatProvider>
        </ArtifactProvider>
    );
}
