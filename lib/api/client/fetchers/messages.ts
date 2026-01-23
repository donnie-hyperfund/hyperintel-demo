import type { ChatMessageDto } from '@/lib/schema/message';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: (projectId: string, chatId: string) => `/api/projects/${projectId}/chats/${chatId}/messages`,
    byId: (projectId: string, chatId: string, messageId: string) =>
        `/api/projects/${projectId}/chats/${chatId}/messages/${messageId}`,
} as const;

export const messageKeys = {
    all: ['messages'] as const,
    lists: () => [...messageKeys.all, 'list'] as const,
    list: (projectId: string, chatId: string, params?: PaginationParams) =>
        [...messageKeys.lists(), projectId, chatId, params] as const,
    details: () => [...messageKeys.all, 'detail'] as const,
    detail: (projectId: string, chatId: string, messageId: string) =>
        [...messageKeys.details(), projectId, chatId, messageId] as const,
};

export function createMessageApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (projectId: string, chatId: string, params?: PaginationParams) => {
            const { data } = await axios.get<PaginatedResponse<ChatMessageDto>>(
                buildUrl(ENDPOINTS.root(projectId, chatId), params as Record<string, string | number | undefined>),
            );
            return data;
        },

        get: async (projectId: string, chatId: string, messageId: string) => {
            const { data } = await axios.get<ChatMessageDto>(ENDPOINTS.byId(projectId, chatId, messageId));
            return data;
        },
    };
}

export type MessageApi = ReturnType<typeof createMessageApi>;
