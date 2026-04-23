import { formatDistanceToNow } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { CamelCaseDto } from '@/lib/api/client/types';
import type { ChatDto } from '@/lib/schema/message';
import { stripMarkdownDirectives } from '@/lib/utils';

type IncompleteChatItemProps = {
    chat: CamelCaseDto<ChatDto>;
    basePath: string;
};

export const IncompleteChatItem = memo(function IncompleteChatItem({ chat, basePath }: IncompleteChatItemProps) {
    const createdAt = chat.createdAt ? new Date(chat.createdAt as string) : null;
    const timeAgo = createdAt ? formatDistanceToNow(createdAt, { addSuffix: true }) : null;

    const preview = chat.firstMessageContent ? stripMarkdownDirectives(chat.firstMessageContent) : 'No messages yet';

    return (
        <Link
            href={`${basePath}/${chat.id}`}
            className="flex w-full items-center gap-5 rounded-3 border border-dashed border-amber-500/40 bg-amber-500/5 px-5 py-4 transition-colors hover:bg-amber-500/10"
        >
            <MessageSquare className="size-5.5 shrink-0 text-amber-500/70" />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="line-clamp-1 text-sm font-medium">{preview}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
                    <span>Started {timeAgo}</span>
                    <span>&middot;</span>
                    <span>
                        {chat.messageCount ?? 0} message{chat.messageCount === 1 ? '' : 's'}
                    </span>
                </div>
            </div>
        </Link>
    );
});

export function IncompleteChatItemSkeleton() {
    return (
        <div className="flex items-center gap-5 rounded-3 border border-dashed px-5 py-4">
            <Skeleton className="size-6 shrink-0 rounded" />
            <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
            </div>
        </div>
    );
}
