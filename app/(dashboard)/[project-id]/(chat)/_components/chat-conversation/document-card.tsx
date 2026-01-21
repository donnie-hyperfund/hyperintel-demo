'use client';

import { useAuth } from '@clerk/nextjs';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';

type DocumentCardProps = {
    name: string;
    version?: number;
    action?: string;
};

export function DocumentCard({ name, version, action }: DocumentCardProps) {
    const params = useParams();
    const projectId = params['project-id'] as string;
    const { getToken } = useAuth();
    const { setCurrentArtifact, artifacts, addArtifact } = useArtifactContext();
    const [isLoading, setIsLoading] = useState(false);

    const icon = action === 'created' ? '📄' : action === 'replaced' ? '📝' : '✏️';

    // Check if artifact is already in context (from streaming)
    const artifactId = version ? `doc-${name}-v${version}` : null;
    const artifactInContext = artifactId ? artifacts[artifactId] : null;

    const handleClick = async () => {
        if (!projectId) return;

        // If artifact is already in context, just show it
        if (artifactId && artifactInContext) {
            setCurrentArtifact(artifactId);
            return;
        }

        // Fetch from backend
        setIsLoading(true);
        try {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, name);

            if (artifact) {
                // Create a local artifact ID and add to context
                const localArtifactId = `doc-${name}-v${artifact.version}`;
                addArtifact({
                    id: localArtifactId,
                    identifier: artifact.key,
                    title: artifact.title,
                    type: 'text/markdown',
                    content: artifact.current_version?.content ?? '',
                    messageId: '',
                });
                setCurrentArtifact(localArtifactId);
            }
        } catch (error) {
            console.error('Failed to fetch artifact:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted hover:bg-muted/80 rounded-lg text-sm mt-2 transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
        >
            <span>{isLoading ? '⏳' : icon}</span>
            <span className="font-medium">{name}</span>
            {version && <span className="text-muted-foreground">v{version}</span>}
        </button>
    );
}
