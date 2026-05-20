'use client';

import { SparklesIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { useArtifactStore } from '@/modules/artifacts/providers/artifact-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

type StreamingInternalDoc = {
    artifactId: string;
    artifactKey: string;
    progress: number;
};

export function ActiveInternalDocs() {
    const store = useArtifactStore();
    const { chatId } = useChatContext();

    const streamingDocs = useMemo<StreamingInternalDoc[]>(() => {
        if (!chatId) return [];
        const docs: StreamingInternalDoc[] = [];
        for (const [artifactId, versions] of Object.entries(store)) {
            for (const artifact of Object.values(versions)) {
                if (
                    artifact.sourceChatId === chatId &&
                    artifact.isStreaming &&
                    artifact.proposedVersion?.isInternal &&
                    !artifact.isSummaryStreaming &&
                    !artifact.summaryStreaming
                ) {
                    docs.push({
                        artifactId,
                        artifactKey: artifact.key,
                        progress: artifact.progress ?? 0,
                    });
                    break;
                }
            }
        }
        return docs;
    }, [store, chatId]);

    if (streamingDocs.length === 0) return null;

    return (
        <div className="mt-3 space-y-2">
            {streamingDocs.map((doc) => (
                <div key={doc.artifactId} className="max-w-sm space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <SparklesIcon className="size-3 shrink-0 animate-pulse text-primary" />
                        <span className="truncate">Generating {doc.artifactKey}</span>
                        <span className="ml-auto shrink-0 tabular-nums">{doc.progress}%</span>
                    </div>
                    <Progress value={doc.progress} className="h-1" />
                </div>
            ))}
        </div>
    );
}
