'use client';

import type { LucideIcon } from 'lucide-react';
import { Building, Building2, Dna, Loader2, Users } from 'lucide-react';
import { useMemo, useRef } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import { useResourceListFilters } from '@/hooks/use-resource-list-filters';
import { useFetchResources } from '@/lib/api/client/hooks/use-resources';
import type { CamelCaseDto } from '@/lib/api/client/types';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { ArtifactListItem, ArtifactListItemSkeleton } from '@/modules/artifacts/components/artifact-list-item';
import { ResourceListToolbar } from '@/modules/artifacts/components/resource-list-toolbar';

type ResourceSelectListProps = {
    selectedIds: string[];
    onToggle: (id: string) => void;
    onClearAll: () => void;
};

export function ResourceSelectList({ selectedIds, onToggle, onClearAll }: ResourceSelectListProps) {
    const filters = useResourceListFilters();

    const { companies, stakeholders, legacyDna, isLoading, hasNextPage, size, setSize } = useFetchResources({
        limit: 20,
        approvedOnly: true,
        documentType: ['Legacy DNA', 'Company Profile', 'Human Persona'],
        search: filters.debouncedSearch,
        ownership: filters.ownership,
    });

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [sentryRef] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => setSize(size + 1),
        rootMargin: '0px 0px 100px 0px',
    });

    const totalCount = useMemo(
        () => companies.length + stakeholders.length + legacyDna.length,
        [companies, stakeholders, legacyDna],
    );

    return (
        <>
            <div className="border-b border-border px-4 py-4">
                <ResourceListToolbar
                    search={filters.search}
                    onSearchChange={filters.setSearch}
                    ownership={filters.ownership}
                    onOwnershipChange={filters.setOwnership}
                    placeholder="Search resources..."
                    compact
                />
            </div>

            {isLoading && size === 1 ? (
                <div className="space-y-2 px-4 py-6">
                    {Array.from({ length: 4 }, (_, i) => (
                        <ArtifactListItemSkeleton key={i} size="sm" />
                    ))}
                </div>
            ) : totalCount === 0 ? (
                <div className="px-8 py-6">
                    <EmptyState
                        icon={Building2}
                        title={filters.hasFilters ? 'No matching resources' : 'No resources yet'}
                        description={
                            filters.hasFilters
                                ? 'Try adjusting your search or filters.'
                                : 'Companies, stakeholders, and legacy DNA will appear here once created.'
                        }
                    />
                </div>
            ) : (
                <div ref={scrollContainerRef} className="max-h-[min(28rem,45dvh)] overflow-y-auto px-4 py-4 space-y-4">
                    <Section
                        title="Legacy DNA"
                        icon={Dna}
                        artifacts={legacyDna}
                        selectedIds={selectedIds}
                        onToggle={onToggle}
                    />
                    <Section
                        title="Companies"
                        icon={Building}
                        artifacts={companies}
                        selectedIds={selectedIds}
                        onToggle={onToggle}
                    />
                    <Section
                        title="Stakeholders"
                        icon={Users}
                        artifacts={stakeholders}
                        selectedIds={selectedIds}
                        onToggle={onToggle}
                    />
                    {(isLoading || hasNextPage) && (
                        <div ref={sentryRef} className="flex items-center justify-center py-3">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        </div>
                    )}
                </div>
            )}

            {selectedIds.length > 0 && (
                <div className="flex items-center justify-between px-6 py-4 bg-neutral-900">
                    <span className="text-sm font-medium text-white">{selectedIds.length} resources selected</span>
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="text-primary hover:text-primary/80 text-sm transition-colors cursor-pointer"
                    >
                        Deselect all
                    </button>
                </div>
            )}
        </>
    );
}

function Section({
    title,
    icon,
    artifacts,
    selectedIds,
    onToggle,
}: {
    title: string;
    icon: LucideIcon;
    artifacts: CamelCaseDto<ArtifactDto>[];
    selectedIds: string[];
    onToggle: (id: string) => void;
}) {
    if (artifacts.length === 0) return null;

    return (
        <div className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-500">{title}</h3>
            <div className="space-y-1.5">
                {artifacts.map((artifact) => (
                    <ArtifactListItem
                        key={artifact.id}
                        artifact={artifact}
                        icon={icon}
                        size="sm"
                        isSelected={selectedIds.includes(artifact.id)}
                        isShared={artifact.isOwn === false}
                        shouldDisplayVersionInfo={false}
                        onClick={() => onToggle(artifact.id)}
                    />
                ))}
            </div>
        </div>
    );
}
