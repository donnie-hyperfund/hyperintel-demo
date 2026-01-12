'use client';

import type { ReactNode } from 'react';
import type { Message } from '../types';
import { ArtifactProvider } from './artifact-provider';
import { ChatProvider } from './chat-provider';
import { StreamingProvider } from './streaming-provider';

type ChatModuleProps = {
    children: ReactNode;
    initialMessages?: Message[];
};

export function ChatModule({ children, initialMessages = [] }: ChatModuleProps) {
    return (
        <StreamingProvider>
            <ArtifactProvider>
                <ChatProvider initialMessages={initialMessages}>{children}</ChatProvider>
            </ArtifactProvider>
        </StreamingProvider>
    );
}
