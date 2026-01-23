import type { ChatDto } from '@/lib/schema/message';

export function sortChatsByCreatedAt(chats: ChatDto[]): ChatDto[] {
    return [...chats].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function getPhaseNumber(chats: ChatDto[], chatId: string): number | null {
    const sorted = sortChatsByCreatedAt(chats);
    const index = sorted.findIndex((c) => c.id === chatId);
    return index >= 0 ? index + 1 : null;
}
