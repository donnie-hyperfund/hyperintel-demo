'use client';

import { FileText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchArtifacts } from '@/lib/api/client/hooks/use-artifacts';
import { ArtifactItem, ArtifactItemSkeleton } from './artifact-item';

export const ArtifactList = () => {
    const params = useParams();
    const projectId = params?.['project-id'] as string | undefined;

    const { data, error, isLoading } = useFetchArtifacts(projectId);
    const artifacts = data?.data ?? [];

    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={FileText}
                    title="Failed to load artifacts"
                    error={error instanceof Error ? error.message : 'An error occurred while loading your artifacts.'}
                />
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                    <ArtifactItemSkeleton key={index} />
                ))}
            </div>
        );
    }

    if (artifacts.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={FileText}
                    title="No artifacts yet"
                    description="Artifacts created during your chats will appear here."
                />
            </div>
        );
    }

    return (
        <>
            <p className="mb-4 text-sm text-neutral-500">
                {artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-3">
                {artifacts.map((artifact) => (
                    <ArtifactItem key={artifact.id} projectId={projectId} artifact={artifact} />
                ))}
            </div>
        </>
    );
};
