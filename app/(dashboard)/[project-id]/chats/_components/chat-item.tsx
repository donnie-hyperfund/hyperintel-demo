'use client';

import { formatDistanceToNow } from 'date-fns';
import { Pen } from 'lucide-react';
import Link from 'next/link';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CamelCaseDto } from '@/lib/api/client/types';
import type { ChatDto } from '@/lib/schema/message';
import { cn } from '@/lib/utils';

type ChatItemProps = {
    chat: CamelCaseDto<ChatDto>;
    projectId?: string;
    phaseNumber: number;
    onEdit: (chatId: string) => void;
};

type ChatItemContentProps = {
    title: string;
    phaseNumber: number;
    timeAgo: string | null;
};

type RenameButtonProps = {
    onClick: () => void;
    className?: string;
};

export const ChatItem = ({ chat, projectId, phaseNumber, onEdit }: ChatItemProps) => {
    const title = chat.name ?? `Phase ${phaseNumber}`;
    const updatedAt = chat.updatedAt ? new Date(chat.updatedAt) : null;
    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : null;
    const href = projectId ? `/${projectId}/${chat.id}` : undefined;

    return (
        <div
            className={cn(
                'group relative flex flex-col rounded-2 border border-border p-3.5 transition-colors md:rounded-3 md:p-5',
                href && 'hover:bg-accent/50',
            )}
        >
            {href && <Link href={href} className="absolute inset-0 rounded-[inherit]" aria-label={title} />}
            <ChatItemContent title={title} phaseNumber={phaseNumber} timeAgo={timeAgo} />
            <RenameButton
                onClick={() => onEdit(chat.id)}
                className={cn(
                    'absolute right-3.5 top-3.5 z-10 text-neutral-400 transition-opacity md:right-5 md:top-5',
                    'opacity-0 group-hover:opacity-100',
                )}
            />
        </div>
    );
};

function ChatItemContent({ title, phaseNumber, timeAgo }: ChatItemContentProps) {
    return (
        <>
            <div className="mb-1.5 pr-8">
                <div className="truncate text-sm font-medium md:text-md">{title}</div>
            </div>
            <div className="mb-3 text-xs text-neutral-500 md:text-sm">Phase {phaseNumber}</div>
            {timeAgo && <div className="text-xs text-neutral-500">Last message {timeAgo}</div>}
        </>
    );
}

function RenameButton({ onClick, className }: RenameButtonProps) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <IconButton size="sm" onClick={onClick} className={className}>
                    <Pen />
                </IconButton>
            </TooltipTrigger>
            <TooltipContent>Rename phase</TooltipContent>
        </Tooltip>
    );
}

export const ChatItemSkeleton = () => {
    return (
        <div className="flex flex-col gap-2 rounded-2 border p-3.5 md:rounded-3 md:p-5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-24" />
        </div>
    );
};
