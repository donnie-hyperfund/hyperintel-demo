import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration } from 'swr';
import type { SWRInfiniteConfiguration } from 'swr/infinite';
import useSWRMutation from 'swr/mutation';
import type { ChatDto } from '@/lib/schema/message';
import { chatKeys, createChatApi } from '../fetchers/chats';
import type { CamelCaseDto, InfinitePaginationParams, PaginatedResponse, PaginationParams } from '../types';
import { useSWRInfinitePaginated } from './use-swr-infinite-paginated';

export function useFetchChats(
    projectId: string | undefined,
    params?: PaginationParams,
    config?: SWRConfiguration<PaginatedResponse<CamelCaseDto<ChatDto>>>,
) {
    const { getToken } = useAuth();

    return useSWR<PaginatedResponse<CamelCaseDto<ChatDto>>>(
        projectId ? chatKeys.list(projectId, params) : null,
        () => {
            if (!projectId) throw new Error('Project ID is required');
            return createChatApi(getToken).list(projectId, params);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchChatsInfinite(
    projectId: string | undefined,
    params: InfinitePaginationParams = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<CamelCaseDto<ChatDto>>>,
) {
    const { getToken } = useAuth();

    return useSWRInfinitePaginated<CamelCaseDto<ChatDto>>(
        (pageIndex, previousPageData) => {
            if (!projectId) return null;
            if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
            return chatKeys.list(projectId, { page: pageIndex + 1, limit: params.limit });
        },
        (key) => {
            if (!projectId) throw new Error('Project ID is required');
            const params = key[key.length - 1] as PaginationParams;
            return createChatApi(getToken).list(projectId, params);
        },
        { revalidateOnFocus: false, revalidateFirstPage: false, ...config },
    );
}

export function useFetchChat(
    projectId: string | undefined,
    chatId: string | undefined,
    config?: SWRConfiguration<CamelCaseDto<ChatDto>>,
) {
    const { getToken } = useAuth();

    return useSWR<CamelCaseDto<ChatDto>>(
        projectId && chatId ? chatKeys.detail(chatId) : null,
        () => {
            if (!chatId) throw new Error('Chat ID is required');
            return createChatApi(getToken).get(chatId);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchIncompleteChatsInfinite(
    framework: string | undefined,
    params: InfinitePaginationParams = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<CamelCaseDto<ChatDto>>>,
) {
    const { getToken } = useAuth();

    return useSWRInfinitePaginated<CamelCaseDto<ChatDto>>(
        (pageIndex, previousPageData) => {
            if (!framework) return null;
            if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
            return chatKeys.incompleteList(framework, { page: pageIndex + 1, limit: params.limit });
        },
        (key) => {
            if (!framework) throw new Error('Framework is required');
            const pageParams = key[key.length - 1] as PaginationParams;
            return createChatApi(getToken).listIncomplete(framework, pageParams);
        },
        { revalidateOnFocus: false, revalidateFirstPage: false, ...config },
    );
}

export function useUpdateChatName(chatId: string) {
    const { getToken } = useAuth();

    return useSWRMutation<{ name: string }, Error, readonly string[], string>(
        [...chatKeys.detail(chatId)],
        (_, { arg: name }) => createChatApi(getToken).updateName(chatId, name),
    );
}

export function useDeleteChat(chatId: string) {
    const { getToken } = useAuth();

    return useSWRMutation<{ message: string }, Error, readonly string[]>([...chatKeys.detail(chatId)], () =>
        createChatApi(getToken).delete(chatId),
    );
}
