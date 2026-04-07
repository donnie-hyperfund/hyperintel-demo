'use client';

import type { LucideIcon } from 'lucide-react';
import { Building2, Loader2 } from 'lucide-react';
import { useMemo, useRef } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import type { useResourceListFilters } from '@/hooks/use-resource-list-filters';
import { useFetchResources } from '@/lib/api/client/hooks/use-resources';
import type { CamelCaseDto } from '@/lib/api/client/types';
import { getArtifactDocumentType } from '@/lib/artifacts/utils';
import type { ArtifactDto, DocumentType } from '@/lib/schema/artifact';
import { DOCUMENT_TYPE_ICON } from '../resource-tabs';
import { ArtifactListItem, ArtifactListItemSkeleton } from './artifact-list-item';

type ResourcePickerPanelProps = {
    documentTypes: DocumentType[];
    filters: ReturnType<typeof useResourceListFilters>;
    icon?: LucideIcon;
    selectedIds: string[];
    onToggle: (id: string) => void;
    excludeProjectId?: string;
    filterItem?: (item: CamelCaseDto<ArtifactDto>) => boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    className?: string;
    skeletonCount?: number;
};

export function ResourcePickerPanel({
    documentTypes,
    filters,
    icon,
    selectedIds,
    onToggle,
    excludeProjectId,
    filterItem,
    emptyTitle,
    emptyDescription,
    className,
    skeletonCount = 3,
}: ResourcePickerPanelProps) {
    const { data, isLoading, hasNextPage, size, setSize } = useFetchResources({
        limit: 20,
        approvedOnly: true,
        documentType: documentTypes,
        excludeProjectId,
        search: filters.debouncedSearch,
        ownership: filters.ownership,
    });

    const allItems = useMemo(() => (data ? data.flatMap((page) => page.data) : []), [data]);

    const visibleItems = useMemo(() => (filterItem ? allItems.filter(filterItem) : allItems), [allItems, filterItem]);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [sentryRef] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => setSize(size + 1),
        rootMargin: '0px 0px 100px 0px',
    });

    if (isLoading && size === 1) {
        return (
            <div className="space-y-2 py-2">
                {Array.from({ length: skeletonCount }).map((_, i) => (
                    <ArtifactListItemSkeleton key={i} size="sm" />
                ))}
            </div>
        );
    }

    if (visibleItems.length === 0) {
        return (
            <EmptyState
                className="flex-1 py-8"
                icon={Building2}
                title={filters.hasFilters ? 'No matching resources' : (emptyTitle ?? 'No resources yet')}
                description={
                    filters.hasFilters
                        ? 'Try adjusting your search or filters.'
                        : (emptyDescription ?? 'Items will appear here once created.')
                }
            />
        );
    }

    return (
        <div ref={scrollContainerRef} className={className ?? 'overflow-y-auto py-2'}>
            <div className="space-y-1.5">
                {visibleItems.map((artifact) => (
                    <ArtifactListItem
                        key={artifact.id}
                        artifact={artifact}
                        icon={icon ?? DOCUMENT_TYPE_ICON[getArtifactDocumentType(artifact) ?? ''] ?? Building2}
                        size="sm"
                        isSelected={selectedIds.includes(artifact.id)}
                        isShared={artifact.isOwn === false}
                        shouldDisplayVersionInfo={false}
                        onClick={() => onToggle(artifact.id)}
                        searchQuery={filters.search}
                    />
                ))}
            </div>
            {(isLoading || hasNextPage) && (
                <div ref={sentryRef} className="flex items-center justify-center py-3">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
            )}
        </div>
    );
}
