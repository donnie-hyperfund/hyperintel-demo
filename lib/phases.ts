import type { CamelCaseDto } from '@/lib/api/client/types';
import type { ChatDto } from '@/lib/schema/message';

export function sortChatsByCreatedAt(chats: CamelCaseDto<ChatDto>[]): CamelCaseDto<ChatDto>[] {
    return [...chats].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function getPhaseNumber(chats: CamelCaseDto<ChatDto>[], chatId: string): number | null {
    const sorted = sortChatsByCreatedAt(chats);
    const index = sorted.findIndex((c) => c.id === chatId);
    return index >= 0 ? index + 1 : null;
}
