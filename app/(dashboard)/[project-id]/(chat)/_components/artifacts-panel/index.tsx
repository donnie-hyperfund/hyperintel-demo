'use client';

import { useAuth } from '@clerk/nextjs';
import { formatDistanceToNow } from 'date-fns';
import { FileText, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { useFetchArtifacts } from '@/lib/api/client/hooks/use-artifacts';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useArtifactContext } from '@/modules/chat/providers/artifact-provider';

interface ArtifactsPanelProps {
    onClose: () => void;
}

export default function ArtifactsPanel({ onClose }: ArtifactsPanelProps) {
    const params = useParams();
    const { getToken } = useAuth();
    const projectId = params?.['project-id'] as string | undefined;
    const { addArtifact, setLoading } = useArtifactContext();
    const { openPanel } = useActivePanelContext();
    const { data: artifactsData, isLoading: artifactsLoading } = useFetchArtifacts(projectId);

    const artifacts = artifactsData?.data ?? [];

    const handleArtifactClick = async (artifactId: string, title: string) => {
        if (!projectId) return;
        setLoading(true, title);
        openPanel({ panel: 'artifact-preview', artifactId: null });

        try {
            const api = createArtifactApi(getToken);
            const artifact = await api.get(projectId, artifactId);
            const localId = `artifact-${artifact.id}-v${artifact.version}`;

            addArtifact({
                id: localId,
                identifier: artifact.key,
                title: artifact.title,
                type: 'text/markdown',
                content: artifact.current_version?.content ?? '',
                messageId: '',
            });
            setLoading(false);
            openPanel({ panel: 'artifact-preview', artifactId: localId });
        } catch {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-neutral-975 animate-in fade-in duration-300">
            <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
                <h2 className="text-sm font-medium">Artifacts</h2>
                <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
                    <X className="size-4" />
                </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
                {artifactsLoading ? (
                    <div className="space-y-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="space-y-2 rounded-lg border p-3">
                                <Skeleton className="h-4 w-3/4" />
                                <Skeleton className="h-3 w-1/2" />
                            </div>
                        ))}
                    </div>
                ) : artifacts.length === 0 ? (
                    <EmptyState
                        icon={FileText}
                        title="No artifacts yet"
                        description="Artifacts created during your phases will appear here."
                    />
                ) : (
                    <div className="space-y-2">
                        {artifacts.map((artifact) => {
                            const updatedAt = artifact.updated_at ? new Date(artifact.updated_at) : null;
                            const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : null;

                            return (
                                <button
                                    key={artifact.id}
                                    type="button"
                                    onClick={() => handleArtifactClick(artifact.id, artifact.title)}
                                    className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <FileText className="size-4 shrink-0 text-neutral-500" />
                                        <span className="line-clamp-1 text-sm font-medium">{artifact.title}</span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 pl-6 text-xs text-neutral-500">
                                        <span>v{artifact.version}</span>
                                        {timeAgo && (
                                            <>
                                                <span>·</span>
                                                <span>{timeAgo}</span>
                                            </>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
