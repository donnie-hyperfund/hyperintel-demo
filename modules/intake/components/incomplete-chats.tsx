'use client';

import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchIncompleteChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { IncompleteChatItem, IncompleteChatItemSkeleton } from './incomplete-chat-item';

const PAGE_SIZE = 20;

type IncompleteChatsProps = {
    framework: 'cpf' | 'hpf';
    basePath: string;
    emptyIcon: LucideIcon;
    emptyTitle: string;
};

export function IncompleteChats({ framework, basePath, emptyIcon, emptyTitle }: IncompleteChatsProps) {
    const { data, error, isLoading, size, setSize, hasNextPage } = useFetchIncompleteChatsInfinite(
        framework,
        { limit: PAGE_SIZE },
        { revalidateFirstPage: true },
    );

    const chats = useMemo(() => data?.flatMap((page) => page.data) ?? [], [data]);

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
                icon={emptyIcon}
                title="Failed to load conversations"
                error={
                    error instanceof Error ? error.message : 'An error occurred while loading incomplete conversations.'
                }
            />
        );
    }

    if (isLoading && size === 1) {
        return (
            <div className="space-y-2 flex-1">
                {Array.from({ length: 4 }).map((_, i) => (
                    <IncompleteChatItemSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (chats.length === 0) {
        return (
            <EmptyState
                className="flex-1"
                icon={emptyIcon}
                title={emptyTitle}
                description="All intake conversations have been completed or removed."
            />
        );
    }

    return (
        <div className="space-y-2 flex-1">
            {chats.map((chat) => (
                <IncompleteChatItem key={chat.id} chat={chat} basePath={basePath} />
            ))}
            {(isLoading || hasNextPage) && (
                <div ref={sentryRef} className="flex items-center justify-center py-3">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
            )}
        </div>
    );
}
