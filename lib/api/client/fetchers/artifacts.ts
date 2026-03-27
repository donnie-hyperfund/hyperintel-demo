import type { ArtifactDto, ArtifactVersionHistoryResponseDto, DocumentType } from '@/lib/schema/artifact';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: '/api/artifacts',
    byId: (artifactId: string) => `/api/artifacts/${artifactId}`,
    byKey: (key: string) => `/api/resources/${key}`,
    versions: '/api/artifacts/versions',
} as const;

export const artifactKeys = {
    all: ['artifacts'] as const,
    lists: () => [...artifactKeys.all, 'list'] as const,
    list: (documentType?: DocumentType, params?: PaginationParams) =>
        [...artifactKeys.lists(), documentType, params] as const,
    history: (key: string) => [...artifactKeys.all, 'history', key] as const,
};

export function getArtifactListInfiniteKey(documentType: DocumentType | undefined, limit = 20) {
    return (pageIndex: number, previousPageData: PaginatedResponse<ArtifactDto> | null) => {
        if (!documentType) return null;
        if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
        return artifactKeys.list(documentType, { page: pageIndex + 1, limit });
    };
}

export function createArtifactApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        delete: async (artifactId: string) => {
            const { data } = await axios.delete<{ success: true; message: string }>(ENDPOINTS.byId(artifactId));
            return data;
        },

        getByKey: async (key: string, version?: number) => {
            const params: Record<string, string | number> = {};
            if (version !== undefined) {
                params.version = version;
            }
            const { data } = await axios.get<ArtifactDto>(buildUrl(ENDPOINTS.byKey(key), params));
            return data;
        },

        listVersionsByKey: async (key: string) => {
            const { data } = await axios.get<ArtifactVersionHistoryResponseDto>(buildUrl(ENDPOINTS.versions, { key }));
            return data;
        },

        list: async (documentType?: DocumentType, paginationParams?: PaginationParams) => {
            const params = {
                ...(documentType ? { document_type: documentType } : undefined),
                ...paginationParams,
            };
            const { data } = await axios.get<PaginatedResponse<ArtifactDto>>(
                buildUrl(ENDPOINTS.root, params as Record<string, string | number | undefined>),
            );
            return data;
        },
    };
}

export type ArtifactApi = ReturnType<typeof createArtifactApi>;
