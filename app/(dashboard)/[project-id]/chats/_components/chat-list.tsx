'use client';

import { MessageSquare, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RenamePhaseDialog } from '@/app/(dashboard)/_components/rename-phase-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import { sortChatsByCreatedAt } from '@/lib/phases';
import { ChatItem, ChatItemSkeleton } from './chat-item';

type ChatListParams = PageParams<'/[project-id]'>;

type ChatListProps = {
    onEmptyChange?: (isEmpty: boolean) => void;
};

export const ChatList = ({ onEmptyChange }: ChatListProps) => {
    const { 'project-id': projectId } = useParams<ChatListParams>();
    const [editingChatId, setEditingChatId] = useState<string | null>(null);
    const [editingInitialName, setEditingInitialName] = useState('');

    const { data, error, isLoading, mutate } = useFetchChats(projectId);
    const chats = sortChatsByCreatedAt(data?.data ?? []).reverse();

    useEffect(() => {
        if (!isLoading) {
            onEmptyChange?.(chats.length === 0);
        }
    }, [chats.length, isLoading, onEmptyChange]);

    const handleEdit = (chatId: string) => {
        const chat = chats.find((c) => c.id === chatId);
        setEditingInitialName(chat?.name ?? '');
        setEditingChatId(chatId);
    };

    const handleSaved = async () => {
        await mutate();
        setEditingChatId(null);
    };

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
                {chats.map((chat) => (
                    <ChatItem
                        key={chat.id}
                        projectId={projectId}
                        chat={chat}
                        phaseNumber={chat.phaseIndex + 1}
                        onEdit={handleEdit}
                    />
                ))}
            </div>

            <RenamePhaseDialog
                chatId={editingChatId}
                initialName={editingInitialName}
                onClose={() => setEditingChatId(null)}
                onSaved={handleSaved}
            />
        </>
    );
};
