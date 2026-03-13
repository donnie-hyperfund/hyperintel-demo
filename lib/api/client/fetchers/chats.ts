import type { CreateIntakeChatBodyDto } from '@/lib/schema/chat';
import type { ChatDto } from '@/lib/schema/message';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: '/api/chats',
    byId: (chatId: string) => `/api/chats/${chatId}`,
} as const;

export const chatKeys = {
    all: ['chats'] as const,
    lists: () => [...chatKeys.all, 'list'] as const,
    list: (projectId?: string, params?: PaginationParams) => [...chatKeys.lists(), projectId, params] as const,
    details: () => [...chatKeys.all, 'detail'] as const,
    detail: (chatId: string) => [...chatKeys.details(), chatId] as const,
};

export function createChatApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (projectId: string, params?: PaginationParams) => {
            const { data } = await axios.get<PaginatedResponse<ChatDto>>(
                buildUrl(ENDPOINTS.root, {
                    projectId,
                    ...params,
                } as Record<string, string | number | undefined>),
            );
            return data;
        },

        get: async (chatId: string) => {
            const { data } = await axios.get<ChatDto>(ENDPOINTS.byId(chatId));
            return data;
        },

        createIntake: async (body: CreateIntakeChatBodyDto) => {
            const { data } = await axios.post<ChatDto>(ENDPOINTS.root, body);
            return data;
        },

        create: async (projectId: string, body?: { title?: string }) => {
            const { data } = await axios.post<ChatDto>(ENDPOINTS.root, { projectId, ...body });
            return data;
        },

        delete: async (chatId: string) => {
            const { data } = await axios.delete<{ message: string }>(ENDPOINTS.byId(chatId));
            return data;
        },
    };
}

export type ChatApi = ReturnType<typeof createChatApi>;
