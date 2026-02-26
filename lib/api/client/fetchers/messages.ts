import type { ChatMessageDto } from '@/lib/schema/message';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: (chatId: string) => `/api/chats/${chatId}/messages`,
} as const;

export const messageKeys = {
    all: ['messages'] as const,
    lists: () => [...messageKeys.all, 'list'] as const,
    list: (chatId: string, params?: PaginationParams) => [...messageKeys.lists(), chatId, params] as const,
};

export function createMessageApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (chatId: string, params?: PaginationParams) => {
            const { data } = await axios.get<PaginatedResponse<ChatMessageDto>>(
                buildUrl(ENDPOINTS.root(chatId), params as Record<string, string | number | undefined>),
            );
            return data;
        },
    };
}

export type MessageApi = ReturnType<typeof createMessageApi>;
