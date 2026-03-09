'use client';

import { useAuth } from '@clerk/nextjs';
import { Building2, Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import { createProjectResourceApi } from '@/lib/api/client/fetchers/project-resources';
import { useFetchProjectResources } from '@/lib/api/client/hooks/use-project-resources';
import { ArtifactListItemSkeleton } from '@/modules/artifacts/components/artifact-list-item';
import { ResourceItem } from './resource-item';

type ResourceListParams = PageParams<'/[project-id]'>;

const PAGE_SIZE = 20;

export function ResourceList() {
    const { 'project-id': projectId } = useParams<ResourceListParams>();
    const { getToken } = useAuth();
    const { allItems, isLoading, error, size, setSize, hasNextPage, mutate } = useFetchProjectResources(projectId, {
        limit: PAGE_SIZE,
    });

    const [sentryRef] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => setSize(size + 1),
        rootMargin: '0px 0px 100px 0px',
    });

    const handleRemove = useCallback(
        async (artifactId: string) => {
            await createProjectResourceApi(getToken).remove(projectId, artifactId);
            await mutate();
        },
        [getToken, projectId, mutate],
    );

    if (isLoading && size === 1) {
        return (
            <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                    <ArtifactListItemSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={Building2}
                    title="Failed to load Project Intel"
                    error={error.message || 'An unexpected error occurred.'}
                />
            </div>
        );
    }

    if (allItems.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={Building2}
                    title="Project Intel is empty"
                    description="Upload files to add to Project Intel."
                />
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            {allItems.map((artifact) => (
                <ResourceItem key={artifact.id} artifact={artifact} onRemove={handleRemove} />
            ))}
            {(isLoading || hasNextPage) && (
                <div ref={sentryRef} className="flex items-center justify-center py-3">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
            )}
        </div>
    );
}
