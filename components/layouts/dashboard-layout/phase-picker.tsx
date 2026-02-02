'use client';

import { Check, ChevronDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverScrollArea, PopoverTrigger } from '@/components/ui/popover';
import type { ChatDto } from '@/lib/schema/message';
import { cn } from '@/lib/utils';

type PhasePickerProps = {
    projectId: string | undefined;
    chats: ChatDto[];
    currentChatId: string | undefined;
    phaseName: string | null;
};

export function PhasePicker({ projectId, chats, currentChatId, phaseName }: PhasePickerProps) {
    const [open, setOpen] = useState(false);
    const isNewChat = !currentChatId;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'flex items-center gap-1 text-sm font-medium rounded-md px-2 py-1 -ml-2 transition-colors hover:bg-accent',
                        isNewChat ? 'text-neutral-500' : 'text-foreground',
                    )}
                >
                    {phaseName ?? 'New phase'}
                    <ChevronDown
                        className={cn(
                            'size-3.5 text-neutral-500 transition-transform duration-200',
                            open && 'rotate-180',
                        )}
                    />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-0">
                <PopoverScrollArea className="py-1">
                    {chats.map((chat, index) => {
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
                                <span className="flex-1 truncate">Phase {index + 1}</span>
                                {isActive && <Check className="size-3.5 text-primary shrink-0" />}
                            </Link>
                        );
                    })}
                    {chats.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No phases yet</div>}
                </PopoverScrollArea>
                <div className="border-t border-border sticky bottom-0 bg-popover">
                    <Link
                        href={`/${projectId}`}
                        onClick={() => setOpen(false)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                        <Plus className="size-3.5" />
                        <span>Create new phase</span>
                    </Link>
                </div>
            </PopoverContent>
        </Popover>
    );
}
