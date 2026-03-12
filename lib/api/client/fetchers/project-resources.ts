import { unstable_serialize } from 'swr/infinite';
import type { ArtifactDto, DocumentType } from '@/lib/schema/artifact';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: (projectId: string) => `/api/projects/${projectId}/resources`,
    byId: (projectId: string, artifactId: string) => `/api/projects/${projectId}/resources/${artifactId}`,
} as const;

export type ProjectResourceListParams = PaginationParams & {
    documentType?: DocumentType[];
};

export const projectResourceKeys = {
    all: (projectId: string) => ['project-resources', projectId] as const,
    lists: (projectId: string) => [...projectResourceKeys.all(projectId), 'list'] as const,
    list: (projectId: string, params?: ProjectResourceListParams) =>
        [...projectResourceKeys.lists(projectId), params] as const,
};

export function getProjectResourceListInfiniteKey(projectId: string, limit = 20) {
    return (pageIndex: number, previousPageData: PaginatedResponse<ArtifactDto> | null) => {
        if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
        return projectResourceKeys.list(projectId, { page: pageIndex + 1, limit });
    };
}

export function serializeProjectResourceListKey(projectId: string, limit = 20) {
    return unstable_serialize(getProjectResourceListInfiniteKey(projectId, limit));
}

export function createProjectResourceApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (projectId: string, params?: ProjectResourceListParams) => {
            const { documentType, ...pagination } = params ?? {};
            const query: Record<string, string | number | undefined> = {
                ...pagination,
                documentType: documentType?.join(','),
            };
            const { data } = await axios.get<PaginatedResponse<ArtifactDto>>(
                buildUrl(ENDPOINTS.root(projectId), query),
            );
            return data;
        },

        remove: async (projectId: string, artifactId: string) => {
            const { data } = await axios.delete<{ success: boolean; message: string }>(
                ENDPOINTS.byId(projectId, artifactId),
            );
            return data;
        },
    };
}
