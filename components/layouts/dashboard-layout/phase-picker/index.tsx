'use client';

import { ChevronDown, Loader2, MessageSquare, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import useInfiniteScroll from 'react-infinite-scroll-hook';
import { RenamePhaseDialog } from '@/app/(dashboard)/_components/rename-phase-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsTruncated } from '@/hooks/use-is-truncated';
import { useFetchChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { cn } from '@/lib/utils';
import { PhasePickerItem } from './phase-picker-item';

const PAGE_SIZE = 20;

type PhasePickerProps = {
    projectId?: string;
    currentChatId?: string;
    currentPhaseIndex?: number | null;
};

export const PhasePicker = ({ projectId, currentChatId, currentPhaseIndex }: PhasePickerProps) => {
    const [open, setOpen] = useState(false);
    const [editingChatId, setEditingChatId] = useState<string | null>(null);
    const [editingInitialName, setEditingInitialName] = useState('');
    const {
        ref: triggerNameRef,
        isTruncated: isTriggerTruncated,
        onMouseEnter: onTriggerMouseEnter,
    } = useIsTruncated();
    const router = useRouter();

    const { data, size, setSize, isLoading, hasNextPage, mutate } = useFetchChatsInfinite(projectId, {
        limit: PAGE_SIZE,
    });

    const chats = useMemo(() => {
        if (!data) return [];
        return data.flatMap((page) => page.data);
    }, [data]);

    const currentChat = chats.find((chat) => chat.id === currentChatId);
    const phaseIndex = currentChat?.phaseIndex ?? currentPhaseIndex;
    const isNewChat = !currentChatId && phaseIndex == null;
    const phaseName = currentChat?.name ?? (typeof phaseIndex === 'number' ? `Phase ${phaseIndex + 1}` : null);

    const [sentryRef, { rootRef }] = useInfiniteScroll({
        loading: isLoading,
        hasNextPage,
        onLoadMore: () => {
            setSize(size + 1);
        },
        rootMargin: '0px 0px 100px 0px',
    });

    const handleNewPhase = (event: React.MouseEvent) => {
        event.preventDefault();
        setOpen(false);
        router.push(`/${projectId}?new=true`);
    };

    const handleEdit = (chatId: string) => {
        const chat = chats.find((chatEntry) => chatEntry.id === chatId);
        setEditingInitialName(chat?.name ?? '');
        setEditingChatId(chatId);
    };

    const handleSaved = async () => {
        await mutate();
        router.refresh();
        setEditingChatId(null);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'group flex items-center gap-1.5 text-sm rounded-md px-2 py-1 min-w-0 transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground cursor-pointer',
                        (isNewChat || !currentChat?.name) && 'text-neutral-500',
                        currentChat?.name && 'text-foreground',
                    )}
                >
                    <Tooltip open={isTriggerTruncated ? undefined : false} delayDuration={750}>
                        <TooltipTrigger asChild>
                            <span ref={triggerNameRef} onMouseEnter={onTriggerMouseEnter} className="truncate max-w-60">
                                {phaseName ?? 'New phase'}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>{phaseName ?? 'New phase'}</TooltipContent>
                    </Tooltip>
                    <ChevronDown className="size-3.5 shrink-0 text-neutral-600 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-w-80 p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
                <div ref={rootRef} className="max-h-64 overflow-y-auto w-full py-1">
                    {chats.map((chat) => (
                        <PhasePickerItem
                            key={chat.id}
                            chat={chat}
                            projectId={projectId}
                            isActive={chat.id === currentChatId}
                            onSelect={() => setOpen(false)}
                            onEdit={handleEdit}
                        />
                    ))}
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
                        href={`/${projectId}?new=true`}
                        onClick={handleNewPhase}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                        <Plus className="size-3.5" />
                        <span>Create new phase</span>
                    </Link>
                </div>

                <RenamePhaseDialog
                    chatId={editingChatId}
                    initialName={editingInitialName}
                    onClose={() => setEditingChatId(null)}
                    onSaved={handleSaved}
                />
            </PopoverContent>
        </Popover>
    );
};
