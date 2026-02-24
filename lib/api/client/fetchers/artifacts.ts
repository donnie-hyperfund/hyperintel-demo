import { unstable_serialize } from 'swr/infinite';
import type { ArtifactDto, FilterableStatus, VisibilityFilter } from '@/lib/schema/artifact';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

export interface ArtifactFilterParams {
    visibility?: VisibilityFilter[];
    status?: FilterableStatus[];
    chatId?: string[];
}

export type ArtifactListParams = PaginationParams & ArtifactFilterParams;

const ENDPOINTS = {
    root: (projectId: string) => `/api/projects/${projectId}/artifacts`,
    byId: (projectId: string, artifactId: string) => `/api/projects/${projectId}/artifacts/${artifactId}`,
    approve: (projectId: string, artifactId: string, versionId: string) =>
        `/api/projects/${projectId}/artifacts/${artifactId}/versions/${versionId}/approve`,
    reject: (projectId: string, artifactId: string, versionId: string) =>
        `/api/projects/${projectId}/artifacts/${artifactId}/versions/${versionId}/reject`,
} as const;

export const artifactKeys = {
    all: ['artifacts'] as const,
    lists: () => [...artifactKeys.all, 'list'] as const,
    list: (projectId: string, params?: ArtifactListParams) => [...artifactKeys.lists(), projectId, params] as const,
    details: () => [...artifactKeys.all, 'detail'] as const,
    detail: (projectId: string, artifactId: string) => [...artifactKeys.details(), projectId, artifactId] as const,
    byKey: (projectId: string, key: string) => [...artifactKeys.details(), projectId, 'key', key] as const,
};

export function getArtifactListInfiniteKey(projectId: string | undefined, limit = 20, filters?: ArtifactFilterParams) {
    return (pageIndex: number, previousPageData: PaginatedResponse<ArtifactDto> | null) => {
        if (!projectId) return null;
        if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
        return artifactKeys.list(projectId, { page: pageIndex + 1, limit, ...filters });
    };
}

export function serializeArtifactListKey(projectId: string, limit = 20) {
    return unstable_serialize(getArtifactListInfiniteKey(projectId, limit));
}

export function createArtifactApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (projectId: string, params?: ArtifactListParams) => {
            const flat: Record<string, string | number | undefined> = {};
            if (params) {
                for (const [k, v] of Object.entries(params)) {
                    if (v === undefined) continue;
                    flat[k] = Array.isArray(v) ? v.join(',') : v;
                }
            }
            const { data } = await axios.get<PaginatedResponse<ArtifactDto>>(buildUrl(ENDPOINTS.root(projectId), flat));
            return data;
        },

        get: async (projectId: string, artifactId: string) => {
            const { data } = await axios.get<ArtifactDto>(ENDPOINTS.byId(projectId, artifactId));
            return data;
        },

        getByKey: async (projectId: string, key: string, version?: number) => {
            const params: Record<string, string | number> = { key };
            if (version !== undefined) {
                params.version = version;
            }
            const { data } = await axios.get<ArtifactDto>(buildUrl(ENDPOINTS.root(projectId), params));
            return data;
        },

        approveVersion: async (projectId: string, artifactId: string, versionId: string) => {
            const { data } = await axios.post<{ success: true; version: number; status: 'approved' }>(
                ENDPOINTS.approve(projectId, artifactId, versionId),
                undefined,
                { timeout: 1200000 },
            );
            return data;
        },

        rejectVersion: async (projectId: string, artifactId: string, versionId: string, reason: string) => {
            const { data } = await axios.post<{ success: true; version: number; status: 'rejected' }>(
                ENDPOINTS.reject(projectId, artifactId, versionId),
                { reason },
                { timeout: 1200000 },
            );
            return data;
        },

        delete: async (projectId: string, artifactId: string) => {
            const { data } = await axios.delete<{ success: true; message: string }>(
                ENDPOINTS.byId(projectId, artifactId),
            );
            return data;
        },
    };
}

export type ArtifactApi = ReturnType<typeof createArtifactApi>;
