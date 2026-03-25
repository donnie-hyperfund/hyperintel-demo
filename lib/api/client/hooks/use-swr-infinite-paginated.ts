import type { BareFetcher } from 'swr';
import type { SWRInfiniteConfiguration, SWRInfiniteKeyLoader, SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';
import type { PaginatedResponse } from '@/lib/api/client/types';

type UseSWRInfinitePaginatedReturn<T> = SWRInfiniteResponse<PaginatedResponse<T>> & {
    hasNextPage: boolean;
};

export function useSWRInfinitePaginated<T>(
    getKey: SWRInfiniteKeyLoader<PaginatedResponse<T>>,
    fetcher: BareFetcher<PaginatedResponse<T>>,
    config?: SWRInfiniteConfiguration<PaginatedResponse<T>, Error, BareFetcher<PaginatedResponse<T>>>,
): UseSWRInfinitePaginatedReturn<T> {
    const result = useSWRInfinite<PaginatedResponse<T>>(getKey, fetcher, config);
    const lastPage = result.data?.[result.data.length - 1];
    const hasNextPage = lastPage ? lastPage.pagination.page < lastPage.pagination.totalPages : false;
    return { ...result, hasNextPage };
}
