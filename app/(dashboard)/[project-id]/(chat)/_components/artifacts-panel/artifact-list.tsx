import { useAuth } from '@clerk/nextjs';
import { FileText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { useFetchArtifacts } from '@/lib/api/client/hooks/use-artifacts';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';
import { ArtifactListItem, ArtifactListItemSkeleton } from './artifact-list-item';

export function ArtifactList() {
    const params = useParams();
    const { getToken } = useAuth();
    const projectId = params?.['project-id'] as string | undefined;
    const { data, error, isLoading } = useFetchArtifacts(projectId);
    const { addArtifact, updateArtifact } = useArtifactContext();
    const { openPanel } = useActivePanelContext();

    const artifacts = data?.data ?? [];

    const handleArtifactClick = useCallback(
        async (artifact: ArtifactDto) => {
            if (!projectId) return;
            const localId = `artifact-${artifact.id}`;

            addArtifact({
                id: localId,
                key: artifact.key,
                title: artifact.title,
                isLoading: true,
            });
            openPanel({ panel: 'artifact-preview', artifactId: localId });

            try {
                const api = createArtifactApi(getToken);
                const data = await api.get(projectId, artifact.id);

                updateArtifact(localId, {
                    ...data,
                    id: localId,
                    key: data.key,
                    isLoading: false,
                });
            } catch {
                updateArtifact(localId, { isLoading: false });
            }
        },
        [projectId, getToken, addArtifact, updateArtifact, openPanel],
    );

    if (error) {
        return (
            <EmptyState
                icon={FileText}
                title="Failed to load artifacts"
                error={error instanceof Error ? error.message : 'An error occurred while loading artifacts.'}
            />
        );
    }

    if (isLoading) {
        return (
            <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                    <ArtifactListItemSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (artifacts.length === 0) {
        return (
            <EmptyState
                icon={FileText}
                title="No artifacts yet"
                description="Artifacts created during your phases will appear here."
            />
        );
    }

    return (
        <div className="space-y-2">
            {artifacts.map((artifact) => (
                <ArtifactListItem key={artifact.id} artifact={artifact} onClick={() => handleArtifactClick(artifact)} />
            ))}
        </div>
    );
}
