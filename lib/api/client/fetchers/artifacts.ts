import { unstable_serialize } from 'swr/infinite';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: '/api/artifacts',
    byId: (artifactId: string) => `/api/artifacts/${artifactId}`,
} as const;

export const artifactKeys = {
    all: ['artifacts'] as const,
    lists: () => [...artifactKeys.all, 'list'] as const,
    list: (projectId: string, params?: PaginationParams) => [...artifactKeys.lists(), projectId, params] as const,
    details: () => [...artifactKeys.all, 'detail'] as const,
    detail: (projectId: string, artifactId: string) => [...artifactKeys.details(), projectId, artifactId] as const,
    byKey: (projectId: string, key: string) => [...artifactKeys.details(), projectId, 'key', key] as const,
};

export function getArtifactListInfiniteKey(projectId: string | undefined, limit = 20) {
    return (pageIndex: number, previousPageData: PaginatedResponse<ArtifactDto> | null) => {
        if (!projectId) return null;
        if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
        return artifactKeys.list(projectId, { page: pageIndex + 1, limit });
    };
}

export function serializeArtifactListKey(projectId: string, limit = 20) {
    return unstable_serialize(getArtifactListInfiniteKey(projectId, limit));
}

export function createArtifactApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (projectId: string, params?: PaginationParams) => {
            const { data } = await axios.get<PaginatedResponse<ArtifactDto>>(
                buildUrl(ENDPOINTS.root, {
                    projectId,
                    ...params,
                } as Record<string, string | number | undefined>),
            );
            return data;
        },

        get: async (_projectId: string, artifactId: string) => {
            const { data } = await axios.get<ArtifactDto>(ENDPOINTS.byId(artifactId));
            return data;
        },

        getByKey: async (projectId: string, key: string, version?: number) => {
            const params: Record<string, string | number> = { projectId, key };
            if (version !== undefined) {
                params.version = version;
            }
            const { data } = await axios.get<ArtifactDto>(buildUrl(ENDPOINTS.root, params));
            return data;
        },

        delete: async (_projectId: string, artifactId: string) => {
            const { data } = await axios.delete<{ success: true; message: string }>(ENDPOINTS.byId(artifactId));
            return data;
        },
    };
}

export type ArtifactApi = ReturnType<typeof createArtifactApi>;
