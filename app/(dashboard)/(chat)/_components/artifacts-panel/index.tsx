'use client';

import { FileText } from 'lucide-react';
import { useArtifacts, useCurrentArtifact } from '@/app/modules/chat/providers/artifact-provider';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { ArtifactHeader } from './artifact-header';

export default function ArtifactsPanel() {
    const { togglePanel } = useArtifacts();
    const artifact = useCurrentArtifact();

    if (!artifact) {
        return (
            <div className="flex flex-col h-full bg-neutral-975">
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <div className="text-center space-y-2">
                        <FileText className="size-12 mx-auto opacity-50" />
                        <p className="text-sm">Select a document to preview</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-neutral-975">
            <ArtifactHeader
                title={artifact.title}
                content={artifact.content}
                onCloseAction={() => togglePanel(false)}
            />

            {/* Preview */}
            <div className="flex-1 overflow-y-auto min-h-0 p-6">
                <MarkdownRenderer markdown={artifact.content} />
            </div>
        </div>
    );
}
