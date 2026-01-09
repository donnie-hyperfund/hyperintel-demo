'use client';

import { useMemo } from 'react';
import type { Message } from '@/app/modules/chat/types';
import { parseArtifactsFromMessage, stripArtifacts } from '@/app/modules/chat/utils/parse-artifacts';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { ArtifactIndicator } from '../artifact-indicator';

type ChatMessageProps = {
    message: Message;
};

export default function ChatMessage({ message }: ChatMessageProps) {
    const { artifacts, strippedContent } = useMemo(() => {
        const artifacts = parseArtifactsFromMessage(message.id, message.content);
        const strippedContent = stripArtifacts(message.content);
        return { artifacts, strippedContent };
    }, [message.id, message.content]);

    if (message.role === 'user') {
        return (
            <div className="max-w-[90%] min-w-0 rounded-4 py-3 px-4 bg-neutral-800 text-foreground justify-self-end mb-9 last:mb-0">
                <div className="min-w-0">
                    <MarkdownRenderer markdown={message.content} variant="message" />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-[90%] min-w-0">
            <div className="min-w-0 space-y-3">
                <MarkdownRenderer markdown={strippedContent} variant="message" />

                {artifacts.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                        {artifacts.map((artifact) => (
                            <ArtifactIndicator key={artifact.id} artifact={artifact} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
