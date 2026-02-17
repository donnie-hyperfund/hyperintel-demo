'use client';

import { formatDistanceToNow } from 'date-fns';
import { FileText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ArtifactViewer } from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel/artifact-viewer';
import { ArtifactViewerSkeleton } from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel/artifact-viewer-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchArtifact } from '@/lib/api/client/hooks/use-artifacts';

export default function ArtifactDetailPage() {
    const params = useParams();
    const projectId = params?.['project-id'] as string | undefined;
    const artifactId = params?.artifactId as string | undefined;

    const { data: artifact, error, isLoading } = useFetchArtifact(projectId, artifactId);

    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={FileText}
                    title="Failed to load deliverable"
                    error={error instanceof Error ? error.message : 'An error occurred while loading the deliverable.'}
                />
            </div>
        );
    }

    if (isLoading || !artifact) {
        return <ArtifactViewerSkeleton />;
    }

    const content = artifact.current_version?.content ?? '';
    const updatedAt = artifact.updated_at ? new Date(artifact.updated_at) : undefined;
    const createdAt = artifact.created_at ? new Date(artifact.created_at) : undefined;

    return (
        <ArtifactViewer
            title={artifact.title}
            content={content}
            version={artifact.version}
            updatedAt={updatedAt || createdAt}
            backHref={`/${projectId}/artifacts`}
        />
    );
}
