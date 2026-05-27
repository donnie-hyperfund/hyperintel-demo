import type { Cache, ScopedMutator } from 'swr';
import type { ChatDto } from '@/lib/schema/message';
import type { CamelCaseDto, PaginatedResponse } from '../types';

type ChatPage = PaginatedResponse<CamelCaseDto<ChatDto>>;
type ChatListCacheData = unknown;

type InsertChatToCacheOptions = {
    cache: Cache;
    mutate: ScopedMutator;
    projectId: string;
    newChat: CamelCaseDto<ChatDto>;
};

function isChatPage(value: unknown): value is ChatPage {
    if (!value || typeof value !== 'object') return false;

    const page = value as Partial<ChatPage>;
    const pagination = page.pagination;

    if (!pagination) return false;

    return (
        Array.isArray(page.data) &&
        typeof pagination.page === 'number' &&
        typeof pagination.limit === 'number' &&
        typeof pagination.total === 'number' &&
        typeof pagination.totalPages === 'number'
    );
}

function isChatListCacheKey(key: unknown, projectId: string): key is string {
    return typeof key === 'string' && key.includes('"chats"') && key.includes('"list"') && key.includes(projectId);
}

function insertChatIntoPages(pages: ChatPage[], newChat: CamelCaseDto<ChatDto>): ChatPage[] {
    if (pages.length === 0) return pages;

    const nextPages = [...pages];
    const lastPage = nextPages[nextPages.length - 1];
    if (!isChatPage(lastPage)) return pages;

    const hasCapacity = lastPage.data.length < lastPage.pagination.limit;
    const total = lastPage.pagination.total + 1;

    nextPages[nextPages.length - 1] = hasCapacity
        ? {
              ...lastPage,
              data: [...lastPage.data, newChat],
              pagination: {
                  ...lastPage.pagination,
                  total,
              },
          }
        : {
              ...lastPage,
              pagination: {
                  ...lastPage.pagination,
                  total,
                  totalPages: Math.ceil(total / lastPage.pagination.limit),
              },
          };

    return nextPages;
}

export function insertChatToCache({ cache, mutate, projectId, newChat }: InsertChatToCacheOptions) {
    for (const key of cache.keys()) {
        if (!isChatListCacheKey(key, projectId)) continue;

        void mutate(
            key,
            (current: ChatListCacheData) => {
                if (Array.isArray(current)) return insertChatIntoPages(current, newChat);
                return current;
            },
            { revalidate: false },
        );
    }
}
