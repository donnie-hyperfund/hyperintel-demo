import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { ChatDto } from '@/lib/schema/message';
import { chatKeys, createChatApi } from '../fetchers/chats';
import type { PaginatedResponse, PaginationParams } from '../types';

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

export function useFetchChat(
    projectId: string | undefined,
    chatId: string | undefined,
    config?: SWRConfiguration<ChatDto>,
) {
    const { getToken } = useAuth();

    return useSWR<ChatDto>(
        projectId && chatId ? chatKeys.detail(projectId, chatId) : null,
        () => {
            if (!projectId || !chatId) throw new Error('Project ID and Chat ID are required');
            return createChatApi(getToken).get(projectId, chatId);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useDeleteChat(projectId: string, chatId: string) {
    const { getToken } = useAuth();

    return useSWRMutation<{ message: string }, Error, readonly string[]>([...chatKeys.detail(projectId, chatId)], () =>
        createChatApi(getToken).delete(projectId, chatId),
    );
}
