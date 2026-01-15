'use client';

import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import type { Message } from '@/modules/chat/types';
import { ArtifactIndicator } from '../artifact-indicator';

type ChatMessageProps = {
    message: Message;
};

export default function ChatMessage({ message }: ChatMessageProps) {
    if (message.role === 'user') {
        return (
            <div className="max-w-[90%] min-w-0 rounded-4 py-3 px-4 bg-neutral-800 text-foreground justify-self-end mb-9 last:mb-0">
                <div className="min-w-0">
                    <MarkdownRenderer markdown={message.content} variant="message" />
                </div>
            </div>
        );
    }

    const artifacts = message.artifacts ?? [];

    return (
        <div className="max-w-[90%] min-w-0">
            <div className="min-w-0 space-y-3">
                <MarkdownRenderer markdown={message.content} variant="message" />

                {artifacts.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                        {artifacts.map((artifactRef) => (
                            <ArtifactIndicator key={artifactRef.id} artifactRef={artifactRef} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
