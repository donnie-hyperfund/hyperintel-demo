'use client';

import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { ChatDto } from '@/lib/schema/message';
import { cn } from '@/lib/utils';

type ChatItemProps = {
    chat: ChatDto;
    projectId?: string;
    phaseNumber: number;
};

export const ChatItem = ({ chat, projectId, phaseNumber }: ChatItemProps) => {
    const router = useRouter();

    const title = `Phase ${phaseNumber}`;
    const updatedAt = chat.updated_at ? new Date(chat.updated_at) : null;
    const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : null;

    const handleChatClick = () => {
        if (!projectId) return;
        router.push(`/${projectId}/chats/${chat.id}`);
    };

    return (
        <Card className={cn('cursor-pointer transition-colors hover:bg-accent/50', 'py-4')} onClick={handleChatClick}>
            <CardHeader className="mb-0 gap-1 py-0">
                <div className="line-clamp-1 text-base font-semibold leading-tight">{title}</div>
            </CardHeader>
            <CardContent className="py-0">
                <div className="text-xs text-neutral-500">{timeAgo && <span>Last message {timeAgo}</span>}</div>
            </CardContent>
        </Card>
    );
};

export const ChatItemSkeleton = () => {
    return (
        <Card className="py-4">
            <CardHeader className="mb-0 gap-1 py-0">
                <Skeleton className="h-5 w-3/4" />
            </CardHeader>
            <CardContent className="py-0">
                <Skeleton className="h-3 w-32" />
            </CardContent>
        </Card>
    );
};
