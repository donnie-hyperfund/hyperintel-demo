import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration } from 'swr';
import useSWRInfinite, { type SWRInfiniteConfiguration } from 'swr/infinite';
import useSWRMutation from 'swr/mutation';
import { artifactKeys, createArtifactApi, getArtifactListInfiniteKey } from '@/lib/api/client/fetchers/artifacts';
import type { InfinitePaginationParams, PaginatedResponse, PaginationParams } from '@/lib/api/client/types';
import type { ArtifactDto, DocumentType } from '@/lib/schema/artifact';

export function useFetchArtifacts(
    documentType: DocumentType | undefined,
    params?: PaginationParams,
    config?: SWRConfiguration<PaginatedResponse<ArtifactDto>>,
) {
    const { getToken } = useAuth();

    return useSWR<PaginatedResponse<ArtifactDto>>(
        documentType ? artifactKeys.list(documentType, params) : null,
        () => {
            if (!documentType) throw new Error('Document type is required');
            return createArtifactApi(getToken).list(documentType, params);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchArtifactsInfinite(
    documentType: DocumentType | undefined,
    params: InfinitePaginationParams = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<ArtifactDto>>,
) {
    const { getToken } = useAuth();

    const result = useSWRInfinite<PaginatedResponse<ArtifactDto>>(
        getArtifactListInfiniteKey(documentType, params.limit),
        (key) => {
            if (!documentType) throw new Error('Document type is required');
            const params = key[key.length - 1] as PaginationParams;
            return createArtifactApi(getToken).list(documentType, params);
        },
        { revalidateOnFocus: false, ...config },
    );

    const lastPage = result.data?.[result.data.length - 1];
    const hasNextPage = lastPage ? lastPage.pagination.page < lastPage.pagination.totalPages : false;

    return { ...result, hasNextPage };
}

export function useDeleteArtifact(artifactId: string) {
    const { getToken } = useAuth();

    return useSWRMutation<{ success: true; message: string }, Error, readonly string[]>(
        [...artifactKeys.all, artifactId, 'delete'],
        () => createArtifactApi(getToken).delete(artifactId),
    );
}
