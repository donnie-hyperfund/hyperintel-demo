'use client';

import { FileText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchArtifact } from '@/lib/api/client/hooks/use-artifacts';
import { ArtifactDetail, ArtifactDetailSkeleton } from '../_components/artifact-detail';

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
                    title="Failed to load artifact"
                    error={error instanceof Error ? error.message : 'An error occurred while loading the artifact.'}
                />
            </div>
        );
    }

    if (isLoading || !artifact) {
        return <ArtifactDetailSkeleton />;
    }

    return <ArtifactDetail artifact={artifact} projectId={projectId!} />;
}
