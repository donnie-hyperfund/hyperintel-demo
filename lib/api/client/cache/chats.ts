import type { Cache, ScopedMutator } from 'swr';
import type { ChatDto } from '@/lib/schema/message';
import type { PaginatedResponse } from '../types';

export function insertChatToCache(cache: Cache, mutate: ScopedMutator, newChat: ChatDto) {
    for (const key of cache.keys()) {
        if (!key.includes('"chats"') || !key.includes('"list"')) continue;

        mutate(
            key,
            (current: PaginatedResponse<ChatDto>[] | undefined) => {
                if (!current || current.length === 0) return current;

                const pages = [...current];
                const lastPage = pages[pages.length - 1];
                const isPageFull = lastPage.data.length >= lastPage.pagination.limit;

                pages[pages.length - 1] = isPageFull
                    ? {
                          ...lastPage,
                          pagination: {
                              ...lastPage.pagination,
                              total: lastPage.pagination.total + 1,
                              totalPages: Math.ceil((lastPage.pagination.total + 1) / lastPage.pagination.limit),
                          },
                      }
                    : {
                          ...lastPage,
                          data: [...lastPage.data, newChat],
                          pagination: {
                              ...lastPage.pagination,
                              total: lastPage.pagination.total + 1,
                          },
                      };

                return pages;
            },
            { revalidate: false },
        );
    }
}
