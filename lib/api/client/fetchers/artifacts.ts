import type { ArtifactDto } from '@/lib/schema/artifact';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: (projectId: string) => `/api/projects/${projectId}/artifacts`,
    byId: (projectId: string, artifactId: string) => `/api/projects/${projectId}/artifacts/${artifactId}`,
} as const;

export const artifactKeys = {
    all: ['artifacts'] as const,
    lists: () => [...artifactKeys.all, 'list'] as const,
    list: (projectId: string, params?: PaginationParams) => [...artifactKeys.lists(), projectId, params] as const,
    details: () => [...artifactKeys.all, 'detail'] as const,
    detail: (projectId: string, artifactId: string) => [...artifactKeys.details(), projectId, artifactId] as const,
};

export function createArtifactApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (projectId: string, params?: PaginationParams) => {
            const { data } = await axios.get<PaginatedResponse<ArtifactDto>>(
                buildUrl(ENDPOINTS.root(projectId), params as Record<string, string | number | undefined>),
            );
            return data;
        },

        get: async (projectId: string, artifactId: string) => {
            const { data } = await axios.get<ArtifactDto>(ENDPOINTS.byId(projectId, artifactId));
            return data;
        },
    };
}

export type ArtifactApi = ReturnType<typeof createArtifactApi>;
