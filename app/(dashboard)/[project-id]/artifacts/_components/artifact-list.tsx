'use client';

import { FileText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchProjectArtifacts } from '@/lib/api/client/hooks/use-project-artifacts';
import { ArtifactItem } from './artifact-item';
import { ArtifactItemSkeleton } from './artifact-item-skeleton';

type ArtifactListParams = PageParams<'/[project-id]'>;

export const ArtifactList = () => {
    const { 'project-id': projectId } = useParams<ArtifactListParams>();

    const { data, error, isLoading } = useFetchProjectArtifacts(projectId);
    const artifacts = data?.data ?? [];

    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={FileText}
                    title="Failed to load deliverables"
                    error={
                        error instanceof Error ? error.message : 'An error occurred while loading your deliverables.'
                    }
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
                    title="No deliverables yet"
                    description="Deliverables created during your chats will appear here."
                />
            </div>
        );
    }

    return (
        <>
            <p className="mb-4 text-sm text-neutral-500">
                {artifacts.length} deliverable{artifacts.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-3">
                {artifacts.map((artifact) => (
                    <ArtifactItem key={artifact.id} projectId={projectId} artifact={artifact} />
                ))}
            </div>
        </>
    );
};
