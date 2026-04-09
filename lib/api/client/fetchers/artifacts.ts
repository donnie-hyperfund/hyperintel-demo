import type { ArtifactDto, DocumentType, OwnershipFilter } from '@/lib/schema/artifact';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { CamelCaseDto, PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: '/api/artifacts',
    byId: (artifactId: string) => `/api/artifacts/${artifactId}`,
    byKey: (key: string) => `/api/resources/${key}`,
} as const;

export type ArtifactListFilterParams = {
    search?: string;
    ownership?: OwnershipFilter;
};

export const artifactKeys = {
    all: ['artifacts'] as const,
    lists: () => [...artifactKeys.all, 'list'] as const,
    list: (documentType?: DocumentType, params?: PaginationParams & ArtifactListFilterParams) =>
        [...artifactKeys.lists(), documentType, params] as const,
};

export function getArtifactListInfiniteKey({
    documentType,
    limit = 20,
    search,
    ownership,
}: {
    documentType: DocumentType | undefined;
    limit?: number;
    search?: string;
    ownership?: OwnershipFilter;
}) {
    return (pageIndex: number, previousPageData: PaginatedResponse<CamelCaseDto<ArtifactDto>> | null) => {
        if (!documentType) return null;
        if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
        return artifactKeys.list(documentType, { page: pageIndex + 1, limit, search, ownership });
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
            const { data } = await axios.get<CamelCaseDto<ArtifactDto>>(buildUrl(ENDPOINTS.byKey(key), params));
            return data;
        },

        list: async (documentType?: DocumentType, params?: PaginationParams & ArtifactListFilterParams) => {
            const { search, ownership, ...paginationParams } = params ?? {};
            const queryParams = {
                ...(documentType ? { document_type: documentType } : undefined),
                ...paginationParams,
                search,
                ownership,
            };
            const { data } = await axios.get<PaginatedResponse<CamelCaseDto<ArtifactDto>>>(
                buildUrl(ENDPOINTS.root, queryParams as Record<string, string | number | undefined>),
            );
            return data;
        },
    };
}

export type ArtifactApi = ReturnType<typeof createArtifactApi>;
