import type { Artifact, Message } from '@/modules/chat/types';

/** Helper to create a text block */
const textBlock = (id: string, content: string) => ({ id, type: 'text' as const, content });

export const MOCK_MESSAGES: Message[] = [
    {
        id: '1',
        role: 'user',
        blocks: [textBlock('text-1', 'Hello, how can you help me today?')],
    },
    {
        id: '2',
        role: 'assistant',
        blocks: [textBlock('text-2', "I'm here to help you with your questions. What would you like to know?")],
    },
];

export const MOCK_ARTIFACTS: Artifact[] = [
    {
        id: 'example-artifact_1',
        key: 'example-artifact',
        proposedVersion: {
            id: 'mock-version-1',
            version: 1,
            title: 'Example Document',
            content: '# Example Document\n\nThis is an example artifact.',
            status: 'proposed',
            createdAt: new Date().toISOString(),
        },
    },
];
