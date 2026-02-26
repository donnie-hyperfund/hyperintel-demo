import type { ArtifactDto, DocumentType } from '@/lib/schema/artifact';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: '/api/resources',
} as const;

export type ResourceListParams = PaginationParams & {
    documentType?: DocumentType[];
};

export const resourceKeys = {
    all: ['resources'] as const,
    lists: () => [...resourceKeys.all, 'list'] as const,
    list: (params?: ResourceListParams) => [...resourceKeys.lists(), params] as const,
};

export function getResourceListInfiniteKey(limit = 20) {
    return (pageIndex: number, previousPageData: PaginatedResponse<ArtifactDto> | null) => {
        if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
        return resourceKeys.list({ page: pageIndex + 1, limit });
    };
}

export function createResourceApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (params?: ResourceListParams) => {
            const { documentType, ...pagination } = params ?? {};
            const query: Record<string, string | number | undefined> = {
                ...pagination,
                documentType: documentType?.join(','),
            };
            const { data } = await axios.get<PaginatedResponse<ArtifactDto>>(buildUrl(ENDPOINTS.root, query));
            return data;
        },
    };
}
