'use client';

import type { LucideIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchIncompleteChats } from '@/lib/api/client/hooks/use-chats';
import { IncompleteChatItem, IncompleteChatItemSkeleton } from './incomplete-chat-item';

type IncompleteChatsProps = {
    framework: 'cpf' | 'hpf';
    basePath: string;
    emptyIcon: LucideIcon;
    emptyTitle: string;
};

export function IncompleteChats({ framework, basePath, emptyIcon, emptyTitle }: IncompleteChatsProps) {
    const { data, isLoading } = useFetchIncompleteChats(framework);

    const chats = data?.data ?? [];

    if (isLoading) {
        return (
            <div className="space-y-2 flex-1">
                {Array.from({ length: 3 }).map((_, i) => (
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
        </div>
    );
}
