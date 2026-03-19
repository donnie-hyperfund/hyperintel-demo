'use client';

import { useAuth } from '@clerk/nextjs';
import { Building2, Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import { useHighlightResourceParam } from '@/hooks/use-highlight-resource-param';
import { createProjectResourceApi } from '@/lib/api/client/fetchers/project-resources';
import { useFetchProjectResources } from '@/lib/api/client/hooks/use-project-resources';
import { deleteArtifact } from '@/lib/api/requests/worker/chat';
import { getLatestArtifactVersion } from '@/lib/artifacts/utils';
import { ArtifactListItemSkeleton } from '@/modules/artifacts/components/artifact-list-item';
import { useProjectResourceDeleteSync } from '@/modules/file-uploads/hooks/use-project-resource-delete-sync';
import { useUploadEntries } from '@/modules/file-uploads/hooks/use-upload-entries';
import { usePendingUploads } from '@/modules/file-uploads/providers/pending-uploads-provider';
import { mergeByDate } from '@/modules/file-uploads/utils/merge-resource-list';
import { ResourceItem } from './resource-item';
import { UploadingResourceItem } from './uploading-resource-item';

type ResourceListParams = PageParams<'/[project-id]'>;

const PAGE_SIZE = 20;

export function ResourceList() {
    const { 'project-id': projectId } = useParams<ResourceListParams>();
    const { getToken } = useAuth();
    const { pendingArtifactIds } = usePendingUploads();

    const {
        allItems: rawItems,
        isLoading,
        error,
        size,
        setSize,
        hasNextPage,
        mutate,
    } = useFetchProjectResources(projectId, { limit: PAGE_SIZE });

    const allItems = useMemo(() => {
        if (pendingArtifactIds.length === 0) return rawItems;
        const pendingSet = new Set(pendingArtifactIds);
        return rawItems.filter((a) => !pendingSet.has(a.id));
    }, [rawItems, pendingArtifactIds]);

    // Cross-tab sync: re-fetch when another tab deletes a resource
    const handleDeleteSync = useCallback(() => {
        mutate();
    }, [mutate]);
    useProjectResourceDeleteSync(projectId, handleDeleteSync);

    const knownArtifactIds = useMemo(() => new Set(allItems.map((a) => a.id)), [allItems]);
    const uploadEntries = useUploadEntries(knownArtifactIds);

    const mergedItems = useMemo(() => mergeByDate(uploadEntries, allItems), [uploadEntries, allItems]);

    const { highlightedKey, registerRef } = useHighlightResourceParam(allItems);

    const [sentryRef] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => setSize(size + 1),
        rootMargin: '0px 0px 100px 0px',
    });

    const handleRemove = useCallback(
        async (artifactId: string) => {
            const artifact = allItems.find((a) => a.id === artifactId);
            const version = artifact && getLatestArtifactVersion(artifact);
            if (version?.is_uploaded) {
                const token = await getToken();
                if (token) await deleteArtifact({ artifactId }, token);
            } else {
                await createProjectResourceApi(getToken).remove(projectId, artifactId);
            }
            await mutate();
        },
        [getToken, projectId, mutate, allItems],
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

    if (mergedItems.length === 0) {
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
            {mergedItems.map((item) =>
                item.kind === 'upload' ? (
                    <UploadingResourceItem
                        key={item.entry.id}
                        name={item.entry.name}
                        size={item.entry.size}
                        status={item.entry.status}
                    />
                ) : (
                    <ResourceItem
                        key={item.artifact.id}
                        artifact={item.artifact}
                        onRemove={handleRemove}
                        isHighlighted={highlightedKey === item.artifact.key}
                        itemRef={(element) => registerRef(item.artifact.id, element)}
                    />
                ),
            )}
            {(isLoading || hasNextPage) && (
                <div ref={sentryRef} className="flex items-center justify-center py-3">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
            )}
        </div>
    );
}
