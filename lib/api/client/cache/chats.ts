import type { Cache, ScopedMutator } from 'swr';
import type { ChatDto } from '@/lib/schema/message';
import type { CamelCaseDto, PaginatedResponse } from '../types';

export function insertChatToCache(
    cache: Cache,
    mutate: ScopedMutator,
    projectId: string,
    newChat: CamelCaseDto<ChatDto>,
) {
    for (const key of cache.keys()) {
        if (!key.includes('"chats"') || !key.includes('"list"') || !key.includes(projectId)) continue;

        mutate(
            key,
            (current: PaginatedResponse<CamelCaseDto<ChatDto>>[] | undefined) => {
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
