'use client';

import { MessageSquare, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import { sortChatsByCreatedAt } from '@/lib/phases';
import { ChatItem, ChatItemSkeleton } from './chat-item';

type ChatListParams = PageParams<'/[project-id]'>;

export const ChatList = () => {
    const { 'project-id': projectId } = useParams<ChatListParams>();

    const { data, error, isLoading } = useFetchChats(projectId);
    const chats = sortChatsByCreatedAt(data?.data ?? []);

    if (error) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={MessageSquare}
                    title="Failed to load chats"
                    error={error instanceof Error ? error.message : 'An error occurred while loading your chats.'}
                />
            </div>
        );
    }

    if (chats.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState
                    icon={MessageSquare}
                    title="No chats yet"
                    description="Start a new conversation to see your chat history here."
                >
                    <Button asChild className="mt-2">
                        <Link href={projectId ? `/${projectId}` : '#'}>
                            <Plus className="size-4" />
                            Start a new chat
                        </Link>
                    </Button>
                </EmptyState>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                    <ChatItemSkeleton key={index} />
                ))}
            </div>
        );
    }

    return (
        <>
            <p className="mb-4 text-sm text-neutral-500">
                {chats.length} phase{chats.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-3">
                {chats.map((chat, index) => (
                    <ChatItem key={chat.id} projectId={projectId} chat={chat} phaseNumber={index + 1} />
                ))}
            </div>
        </>
    );
};
