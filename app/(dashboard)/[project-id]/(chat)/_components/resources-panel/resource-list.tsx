'use client';

import { Building2, Loader2 } from 'lucide-react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchResources } from '@/lib/api/client/hooks/use-resources';
import { ArtifactItemSkeleton } from '@/modules/artifacts/components/artifact-list-item';
import { ResourceSection } from './resource-section';

const PAGE_SIZE = 20;

export function ResourceList() {
    const { companies, stakeholders, isLoading, error, size, setSize, hasNextPage } = useFetchResources({
        limit: PAGE_SIZE,
    });

    const [sentryRef] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => setSize(size + 1),
        rootMargin: '0px 0px 100px 0px',
    });

    if (isLoading && size === 1) {
        return (
            <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                    <ArtifactItemSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={Building2}
                    title="Failed to load resources"
                    error={error.message || 'An unexpected error occurred.'}
                />
            </div>
        );
    }

    const isEmpty = companies.length === 0 && stakeholders.length === 0;

    if (isEmpty) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={Building2}
                    title="No resources yet"
                    description="Companies & stakeholders will appear here once generated."
                />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <ResourceSection title="Companies" artifacts={companies} />
            <ResourceSection title="Stakeholders" artifacts={stakeholders} />
            {(isLoading || hasNextPage) && (
                <div ref={sentryRef} className="flex items-center justify-center py-3">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
            )}
        </div>
    );
}
