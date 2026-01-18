import type { ChatDto } from '@/lib/schema/message';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: (projectId: string) => `/api/projects/${projectId}/chats`,
    byId: (projectId: string, chatId: string) => `/api/projects/${projectId}/chats/${chatId}`,
} as const;

export const chatKeys = {
    all: ['chats'] as const,
    lists: () => [...chatKeys.all, 'list'] as const,
    list: (projectId: string, params?: PaginationParams) => [...chatKeys.lists(), projectId, params] as const,
    details: () => [...chatKeys.all, 'detail'] as const,
    detail: (projectId: string, chatId: string) => [...chatKeys.details(), projectId, chatId] as const,
};

export function createChatApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (projectId: string, params?: PaginationParams) => {
            const { data } = await axios.get<PaginatedResponse<ChatDto>>(
                buildUrl(ENDPOINTS.root(projectId), params as Record<string, string | number | undefined>),
            );
            return data;
        },

        get: async (projectId: string, chatId: string) => {
            const { data } = await axios.get<ChatDto>(ENDPOINTS.byId(projectId, chatId));
            return data;
        },

        create: async (projectId: string, body?: { title?: string }) => {
            const { data } = await axios.post<ChatDto>(ENDPOINTS.root(projectId), body || {});
            return data;
        },

        delete: async (projectId: string, chatId: string) => {
            const { data } = await axios.delete<{ message: string }>(ENDPOINTS.byId(projectId, chatId));
            return data;
        },
    };
}

export type ChatApi = ReturnType<typeof createChatApi>;
