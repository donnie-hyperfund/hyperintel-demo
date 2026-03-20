import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration } from 'swr';
import type { SWRInfiniteConfiguration } from 'swr/infinite';
import useSWRMutation from 'swr/mutation';
import type { ChatDto } from '@/lib/schema/message';
import { chatKeys, createChatApi } from '../fetchers/chats';
import type { InfinitePaginationParams, PaginatedResponse, PaginationParams } from '../types';
import { useSWRInfinitePaginated } from './use-swr-infinite-paginated';

export function useFetchChats(
    projectId: string | undefined,
    params?: PaginationParams,
    config?: SWRConfiguration<PaginatedResponse<ChatDto>>,
) {
    const { getToken } = useAuth();

    return useSWR<PaginatedResponse<ChatDto>>(
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
    config?: SWRInfiniteConfiguration<PaginatedResponse<ChatDto>>,
) {
    const { getToken } = useAuth();

    return useSWRInfinitePaginated<ChatDto>(
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
    config?: SWRConfiguration<ChatDto>,
) {
    const { getToken } = useAuth();

    return useSWR<ChatDto>(
        projectId && chatId ? chatKeys.detail(chatId) : null,
        () => {
            if (!chatId) throw new Error('Chat ID is required');
            return createChatApi(getToken).get(chatId);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useDeleteChat(chatId: string) {
    const { getToken } = useAuth();

    return useSWRMutation<{ message: string }, Error, readonly string[]>([...chatKeys.detail(chatId)], () =>
        createChatApi(getToken).delete(chatId),
    );
}
