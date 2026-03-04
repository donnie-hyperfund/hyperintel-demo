'use client';

import { Building, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchArtifactsInfinite } from '@/lib/api/client/hooks/use-artifacts';
import { ArtifactListItem, ArtifactListItemSkeleton } from '@/modules/artifacts/components/artifact-list-item';
import { getArtifactChatId } from '@/modules/artifacts/utils';

const PAGE_SIZE = 20;

export const CompanyList = () => {
    const { data, error, isLoading, size, setSize, hasNextPage } = useFetchArtifactsInfinite('Company Profile', {
        limit: PAGE_SIZE,
    });

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

    if (error) {
        return (
            <EmptyState
                className="flex-1"
                icon={Building}
                title="Failed to load companies"
                error={error instanceof Error ? error.message : 'An error occurred while loading company profiles.'}
            />
        );
    }

    if (artifacts.length === 0 && !isLoading) {
        return (
            <EmptyState
                className="flex-1"
                icon={Building}
                title="No company profiles yet"
                description="Start a new conversation to build organizational intelligence about a company."
            >
                <Button asChild className="mt-2">
                    <Link href="/companies/new">
                        <Plus className="size-4" />
                        New company
                    </Link>
                </Button>
            </EmptyState>
        );
    }

    if (isLoading) {
        return (
            <div className="space-y-2 flex-1">
                {Array.from({ length: 4 }).map((_, index) => (
                    <ArtifactListItemSkeleton key={index} />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-2 flex-1">
            {artifacts.map((artifact) => {
                const chatId = getArtifactChatId(artifact);
                const href = chatId ? `/companies/${chatId}` : undefined;

                return <ArtifactListItem key={artifact.id} artifact={artifact} icon={Building} href={href} />;
            })}
            {(isLoading || hasNextPage) && (
                <div ref={sentryRef} className="flex items-center justify-center py-3">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
            )}
        </div>
    );
};
