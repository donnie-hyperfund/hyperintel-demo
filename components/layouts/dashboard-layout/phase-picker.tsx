'use client';

import { Check, ChevronDown, Loader2, MessageSquare, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { EmptyState } from '@/components/ui/empty-state';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFetchChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

type PhasePickerProps = {
    projectId?: string;
    currentChatId?: string;
    currentPhaseIndex?: number | null;
};

export const PhasePicker = ({ projectId, currentChatId, currentPhaseIndex }: PhasePickerProps) => {
    const [open, setOpen] = useState(false);
    const router = useRouter();

    const isNewChat = !currentPhaseIndex;
    const phaseName = typeof currentPhaseIndex === 'number' ? `Phase ${currentPhaseIndex + 1}` : null;

    const { data, size, setSize, isLoading, hasNextPage } = useFetchChatsInfinite(projectId, { limit: PAGE_SIZE });

    const chats = useMemo(() => {
        if (!data) return [];
        return data.flatMap((page) => page.data);
    }, [data]);

    const [sentryRef, { rootRef }] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => {
            setSize(size + 1);
        },
        rootMargin: '0px 0px 100px 0px',
    });

    const handleNewPhase = (e: React.MouseEvent) => {
        e.preventDefault();
        setOpen(false);
        window.dispatchEvent(new Event('new-phase'));
        router.push(`/${projectId}`);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'group flex items-center gap-1.5 text-sm rounded-md px-2 py-1 transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
                        isNewChat && 'text-neutral-500',
                    )}
                >
                    {phaseName ?? 'New phase'}
                    <ChevronDown className="size-3.5 text-neutral-500 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-0">
                <div ref={rootRef} className="max-h-64 overflow-y-auto py-1">
                    {chats.map((chat) => {
                        const isActive = chat.id === currentChatId;
                        return (
                            <Link
                                key={chat.id}
                                href={`/${projectId}/${chat.id}`}
                                onClick={() => setOpen(false)}
                                className={cn(
                                    'flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent',
                                    isActive && 'bg-accent/50',
                                )}
                            >
                                <span className="flex-1 truncate">Phase {chat.phase_index + 1}</span>
                                {isActive && <Check className="size-3.5 text-primary shrink-0" />}
                            </Link>
                        );
                    })}
                    {(isLoading || hasNextPage) && (
                        <div ref={sentryRef} className="flex items-center justify-center py-2">
                            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                        </div>
                    )}
                    {!isLoading && chats.length === 0 && (
                        <EmptyState
                            icon={MessageSquare}
                            title="No phases yet"
                            description="Create a new phase to get started"
                            size="sm"
                            className="px-6 h-48"
                        />
                    )}
                </div>
                <div className="border-t border-border sticky bottom-0 bg-popover">
                    <Link
                        href={`/${projectId}`}
                        onClick={handleNewPhase}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                        <Plus className="size-3.5" />
                        <span>Create new phase</span>
                    </Link>
                </div>
            </PopoverContent>
        </Popover>
    );
};
