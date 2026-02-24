import { unstable_serialize } from 'swr/infinite';
import type { ArtifactDto, FilterableStatus, VisibilityFilter } from '@/lib/schema/artifact';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

export interface ProjectArtifactFilterParams {
    visibility?: VisibilityFilter[];
    status?: FilterableStatus[];
    chatId?: string[];
}

export type ProjectArtifactListParams = PaginationParams & ProjectArtifactFilterParams;

const ENDPOINTS = {
    root: (projectId: string) => `/api/projects/${projectId}/artifacts`,
    byId: (projectId: string, artifactId: string) => `/api/projects/${projectId}/artifacts/${artifactId}`,
    approve: (projectId: string, artifactId: string, versionId: string) =>
        `/api/projects/${projectId}/artifacts/${artifactId}/versions/${versionId}/approve`,
    reject: (projectId: string, artifactId: string, versionId: string) =>
        `/api/projects/${projectId}/artifacts/${artifactId}/versions/${versionId}/reject`,
} as const;

export const projectArtifactKeys = {
    all: ['artifacts'] as const,
    lists: () => [...projectArtifactKeys.all, 'list'] as const,
    list: (projectId: string, params?: ProjectArtifactListParams) =>
        [...projectArtifactKeys.lists(), projectId, params] as const,
    details: () => [...projectArtifactKeys.all, 'detail'] as const,
    detail: (projectId: string, artifactId: string) =>
        [...projectArtifactKeys.details(), projectId, artifactId] as const,
    byKey: (projectId: string, key: string) => [...projectArtifactKeys.details(), projectId, 'key', key] as const,
};

export function getProjectArtifactListInfiniteKey(
    projectId: string | undefined,
    limit = 20,
    filters?: ProjectArtifactFilterParams,
) {
    return (pageIndex: number, previousPageData: PaginatedResponse<ArtifactDto> | null) => {
        if (!projectId) return null;
        if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
        return projectArtifactKeys.list(projectId, { page: pageIndex + 1, limit, ...filters });
    };
}

export function serializeProjectArtifactListKey(projectId: string, limit = 20) {
    return unstable_serialize(getProjectArtifactListInfiniteKey(projectId, limit));
}

export function createProjectArtifactApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (projectId: string, params?: ProjectArtifactListParams) => {
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

export type ArtifactApi = ReturnType<typeof createProjectArtifactApi>;
