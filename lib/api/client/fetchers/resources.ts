import type { ArtifactDto, DocumentType } from '@/lib/schema/artifact';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: '/api/resources',
    byKey: (key: string) => `/api/resources/${key}`,
} as const;

export type ResourceListParams = PaginationParams & {
    documentType?: DocumentType[];
    approvedOnly?: boolean;
    excludeProjectId?: string;
};

export const resourceKeys = {
    all: ['resources'] as const,
    lists: () => [...resourceKeys.all, 'list'] as const,
    list: (params?: ResourceListParams) => [...resourceKeys.lists(), params] as const,
};

export function getResourceListInfiniteKey(
    limit = 20,
    approvedOnly?: boolean,
    documentType?: DocumentType[],
    excludeProjectId?: string,
) {
    return (pageIndex: number, previousPageData: PaginatedResponse<ArtifactDto> | null) => {
        if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
        return resourceKeys.list({ page: pageIndex + 1, limit, approvedOnly, documentType, excludeProjectId });
    };
}

export function createResourceApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        getByKey: async (key: string, version?: number) => {
            const params: Record<string, string | number> = {};
            if (version !== undefined) {
                params.version = version;
            }
            const { data } = await axios.get<ArtifactDto>(buildUrl(ENDPOINTS.byKey(key), params));
            return data;
        },

        list: async (params?: ResourceListParams) => {
            const { documentType, approvedOnly, excludeProjectId, ...pagination } = params ?? {};
            const query: Record<string, string | number | undefined> = {
                ...pagination,
                documentType: documentType?.join(','),
                approvedOnly: approvedOnly ? 'true' : undefined,
                excludeProjectId,
            };
            const { data } = await axios.get<PaginatedResponse<ArtifactDto>>(buildUrl(ENDPOINTS.root, query));
            return data;
        },
    };
}
