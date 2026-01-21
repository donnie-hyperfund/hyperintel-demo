'use client';

import { FileText } from 'lucide-react';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import { ArtifactViewer } from './artifact-viewer';

/** Chat panel wrapper that uses artifact context */
export default function ArtifactsPanel() {
    const { togglePanel, currentArtifact } = useArtifactContext();

    if (!currentArtifact) {
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
        <ArtifactViewer
            title={currentArtifact.title}
            content={currentArtifact.content}
            onCloseAction={() => togglePanel(false)}
        />
    );
}
