import { useAuth } from '@clerk/nextjs';
import { FileText, Loader2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import type { ProjectArtifactFilterParams } from '@/lib/api/client/fetchers/project-artifacts';
import { createProjectArtifactApi } from '@/lib/api/client/fetchers/project-artifacts';
import { useFetchProjectArtifactsInfinite } from '@/lib/api/client/hooks/use-project-artifacts';
import type { CamelCaseDto } from '@/lib/api/client/types';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { ArtifactListItem, ArtifactListItemSkeleton } from '@/modules/artifacts/components/artifact-list-item';
import { useArtifactActions } from '@/modules/artifacts/providers/artifact-provider';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import type { ProjectArtifactFilters } from './project-artifact-filter-dropdown';
import { getActiveFilterCount } from './project-artifact-filter-dropdown';

function filtersToParams(filters: ProjectArtifactFilters): ProjectArtifactFilterParams {
    const params: ProjectArtifactFilterParams = {};
    if (filters.visibility.length) params.visibility = filters.visibility;
    if (filters.status.length) params.status = filters.status;
    if (filters.chatIds.length) params.chatId = filters.chatIds;
    return params;
}

const PAGE_SIZE = 20;

type ProjectArtifactListProps = {
    filters: ProjectArtifactFilters;
};

export function ProjectArtifactList({ filters }: ProjectArtifactListProps) {
    const { getToken } = useAuth();

    const { projectId } = useChatContext<'phase'>();

    const filterParams = useMemo(() => filtersToParams(filters), [filters]);

    const { data, error, isLoading, size, setSize, hasNextPage } = useFetchProjectArtifactsInfinite(projectId, {
        limit: PAGE_SIZE,
        ...filterParams,
    });

    const { addArtifact, updateArtifact } = useArtifactActions();
    const { pushPanel } = useActivePanelContext();

    const artifacts = useMemo(() => {
        if (!data) return [];
        return data.flatMap((page) => page.data);
    }, [data]);

    const [sentryRef] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => setSize(size + 1),
        rootMargin: '0px 0px 100px 0px',
    });

    const openArtifactPreview = useCallback(
        async (artifact: CamelCaseDto<ArtifactDto>) => {
            if (!projectId) return;
            const localId = artifact.key;
            const version = artifact.version;

            addArtifact({ id: localId, key: artifact.key, isLoading: true }, version);
            pushPanel({ panel: 'artifact-preview', artifactId: localId, version });

            try {
                const api = createProjectArtifactApi(getToken);
                const data = await api.getByKey(projectId, artifact.key, version);
                updateArtifact(localId, { ...data, id: localId, key: data.key, isLoading: false }, version);
            } catch {
                updateArtifact(localId, { isLoading: false }, version);
            }
        },
        [projectId, getToken, addArtifact, updateArtifact, pushPanel],
    );

    const handleArtifactClick = useCallback(
        (artifact: CamelCaseDto<ArtifactDto>) => {
            if (!projectId) return;
            void openArtifactPreview(artifact);
        },
        [projectId, openArtifactPreview],
    );

    if (isLoading) {
        return (
            <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                    <ArtifactListItemSkeleton key={i} size="sm" />
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={FileText}
                    title="Failed to load artifacts"
                    error={error instanceof Error ? error.message : 'An error occurred while loading artifacts.'}
                />
            </div>
        );
    }

    const hasActiveFilters = getActiveFilterCount(filters) > 0;

    if (artifacts.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={FileText}
                    title={hasActiveFilters ? 'No artifacts match these filters' : 'No artifacts yet'}
                    description={
                        hasActiveFilters
                            ? undefined
                            : 'Artifacts will appear here as they are generated throughout the project journey.'
                    }
                />
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {artifacts.map((artifact) => (
                <ArtifactListItem
                    key={artifact.id}
                    artifact={artifact}
                    size="sm"
                    onClick={() => handleArtifactClick(artifact)}
                />
            ))}
            {(isLoading || hasNextPage) && (
                <div ref={sentryRef} className="flex items-center justify-center py-3">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
            )}
        </div>
    );
}
