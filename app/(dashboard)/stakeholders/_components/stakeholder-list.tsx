'use client';

import { Loader2, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useResourceListFilters } from '@/hooks/use-resource-list-filters';
import { useFetchArtifactsInfinite } from '@/lib/api/client/hooks/use-artifacts';
import { ArtifactListItem, ArtifactListItemSkeleton } from '@/modules/artifacts/components/artifact-list-item';
import { ResourceListToolbar } from '@/modules/artifacts/components/resource-list-toolbar';
import { getLatestArtifactVersionChatId } from '@/modules/artifacts/utils';

const PAGE_SIZE = 20;

type StakeholderListProps = {
    onEmptyChange?: (isEmpty: boolean) => void;
};

export const StakeholderList = ({ onEmptyChange }: StakeholderListProps) => {
    const filters = useResourceListFilters();

    const { data, error, isLoading, size, setSize, hasNextPage } = useFetchArtifactsInfinite('Human Persona', {
        limit: PAGE_SIZE,
        search: filters.debouncedSearch,
        ownership: filters.ownership,
    });

    const artifacts = useMemo(() => data?.flatMap((page) => page.data) ?? [], [data]);

    useEffect(() => {
        if (!isLoading) {
            onEmptyChange?.(artifacts.length === 0 && !filters.hasFilters);
        }
    }, [artifacts.length, isLoading, filters.hasFilters, onEmptyChange]);

    const [sentryRef] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => setSize(size + 1),
        rootMargin: '0px 0px 100px 0px',
    });

    if (error) {
        return (
            <EmptyState
                className="flex-1"
                icon={Users}
                title="Failed to load stakeholders"
                error={error instanceof Error ? error.message : 'An error occurred while loading stakeholder profiles.'}
            />
        );
    }

    return (
        <div className="flex flex-col flex-1 gap-4">
            <ResourceListToolbar
                search={filters.search}
                onSearchChange={filters.setSearch}
                ownership={filters.ownership}
                onOwnershipChange={filters.setOwnership}
                placeholder="Search stakeholders..."
            />
            {isLoading && size === 1 ? (
                <div className="space-y-2 flex-1">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <ArtifactListItemSkeleton key={i} />
                    ))}
                </div>
            ) : artifacts.length === 0 ? (
                <EmptyState
                    className="flex-1"
                    icon={Users}
                    title={filters.hasFilters ? 'No matching stakeholders' : 'No stakeholder profiles yet'}
                    description={
                        filters.hasFilters
                            ? 'Try adjusting your search or filters.'
                            : 'Start a new conversation to map and profile a stakeholder.'
                    }
                >
                    {!filters.hasFilters && (
                        <Button asChild className="mt-2">
                            <Link href="/stakeholders/new">
                                <Plus className="size-4" />
                                New stakeholder
                            </Link>
                        </Button>
                    )}
                </EmptyState>
            ) : (
                <div className="space-y-2 flex-1">
                    {artifacts.map((artifact) => {
                        const isShared = artifact.isOwn === false;
                        const chatId = getLatestArtifactVersionChatId(artifact);
                        return (
                            <ArtifactListItem
                                key={artifact.id}
                                artifact={artifact}
                                icon={Users}
                                href={!isShared && chatId ? `/stakeholders/${chatId}` : undefined}
                                isShared={isShared}
                            />
                        );
                    })}
                    {(isLoading || hasNextPage) && (
                        <div ref={sentryRef} className="flex items-center justify-center py-3">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
