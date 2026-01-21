'use client';

import { FileText } from 'lucide-react';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';

type DocumentCardProps = {
    name: string;
    version?: number;
    action?: string;
};

export function DocumentCard({ name, version, action }: DocumentCardProps) {
    const { setCurrentArtifact, artifacts } = useArtifactContext();

    const icon = action === 'created' ? '📄' : action === 'replaced' ? '📝' : '✏️';

    // Find the artifact by name and version
    const artifactId = version ? `doc-${name}-v${version}` : null;
    const artifact = artifactId ? artifacts[artifactId] : null;

    const handleClick = () => {
        if (artifactId) {
            setCurrentArtifact(artifactId);
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={!artifact}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted/80 rounded-lg text-sm mt-2 transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
        >
            <span>{icon}</span>
            <span className="font-medium">{name}</span>
            {version && <span className="text-muted-foreground">v{version}</span>}
        </button>
    );
}
