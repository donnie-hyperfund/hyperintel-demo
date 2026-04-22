import type { CreateIntakeChatBodyDto } from '@/lib/schema/chat';
import type { ChatDto } from '@/lib/schema/message';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { CamelCaseDto, PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: '/api/chats',
    byId: (chatId: string) => `/api/chats/${chatId}`,
    model: (chatId: string) => `/api/chats/${chatId}/model`,
} as const;

export interface IncompleteChatsParams extends PaginationParams {
    framework: string;
}

export const chatKeys = {
    all: ['chats'] as const,
    lists: () => [...chatKeys.all, 'list'] as const,
    list: (projectId?: string, params?: PaginationParams) => [...chatKeys.lists(), projectId, params] as const,
    incomplete: (framework: string, params?: PaginationParams) =>
        [...chatKeys.all, 'incomplete', framework, params] as const,
    details: () => [...chatKeys.all, 'detail'] as const,
    detail: (chatId: string) => [...chatKeys.details(), chatId] as const,
};

export function createChatApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (projectId: string, params?: PaginationParams) => {
            const { data } = await axios.get<PaginatedResponse<CamelCaseDto<ChatDto>>>(
                buildUrl(ENDPOINTS.root, {
                    projectId,
                    ...params,
                } as Record<string, string | number | undefined>),
            );
            return data;
        },

        listIncomplete: async (framework: string, params?: PaginationParams) => {
            const { data } = await axios.get<PaginatedResponse<CamelCaseDto<ChatDto>>>(
                buildUrl(ENDPOINTS.root, {
                    type: 'intake',
                    framework,
                    incomplete: 'true',
                    ...params,
                } as Record<string, string | number | undefined>),
            );
            return data;
        },

        get: async (chatId: string) => {
            const { data } = await axios.get<CamelCaseDto<ChatDto>>(ENDPOINTS.byId(chatId));
            return data;
        },

        createIntake: async (body: CreateIntakeChatBodyDto) => {
            const { data } = await axios.post<CamelCaseDto<ChatDto>>(ENDPOINTS.root, body);
            return data;
        },

        create: async (projectId: string, body?: { title?: string }) => {
            const { data } = await axios.post<CamelCaseDto<ChatDto>>(ENDPOINTS.root, { projectId, ...body });
            return data;
        },

        delete: async (chatId: string) => {
            const { data } = await axios.delete<{ message: string }>(ENDPOINTS.byId(chatId));
            return data;
        },

        updateName: async (chatId: string, name: string) => {
            const { data } = await axios.patch<CamelCaseDto<{ name: string }>>(ENDPOINTS.byId(chatId), { name });
            return data;
        },

        updateModel: async (chatId: string, model: string) => {
            const { data } = await axios.patch<CamelCaseDto<{ selected_model: string }>>(ENDPOINTS.model(chatId), {
                model,
            });
            return data;
        },
    };
}

export type ChatApi = ReturnType<typeof createChatApi>;
