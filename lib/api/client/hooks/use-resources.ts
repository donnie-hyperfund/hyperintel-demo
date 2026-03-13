import { useAuth } from '@clerk/nextjs';
import { useMemo } from 'react';
import useSWRInfinite, { type SWRInfiniteConfiguration } from 'swr/infinite';
import {
    createResourceApi,
    getResourceListInfiniteKey,
    type ResourceListParams,
} from '@/lib/api/client/fetchers/resources';
import type { InfinitePaginationParams, PaginatedResponse } from '@/lib/api/client/types';
import { getArtifactDocumentType } from '@/lib/artifacts/utils';
import type { ArtifactDto, DocumentType } from '@/lib/schema/artifact';

export function useFetchResources(
    params: InfinitePaginationParams & {
        approvedOnly?: boolean;
        documentType?: DocumentType[];
        excludeProjectId?: string;
    } = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<ArtifactDto>>,
) {
    const { getToken } = useAuth();
    const { approvedOnly, documentType, excludeProjectId } = params;

    const result = useSWRInfinite<PaginatedResponse<ArtifactDto>>(
        getResourceListInfiniteKey(params.limit, approvedOnly, documentType, excludeProjectId),
        (key) => {
            const pageParams = key[key.length - 1] as ResourceListParams;
            return createResourceApi(getToken).list(pageParams);
        },
        { revalidateOnFocus: false, ...config },
    );

    const lastPage = result.data?.[result.data.length - 1];
    const hasNextPage = lastPage ? lastPage.pagination.page < lastPage.pagination.totalPages : false;

    const allItems = useMemo(() => {
        if (!result.data) return [];
        return result.data.flatMap((page) => page.data);
    }, [result.data]);

    const { companies, stakeholders, legacyDna } = useMemo(
        () => ({
            companies: allItems.filter((a) => getArtifactDocumentType(a) === 'Company Profile'),
            stakeholders: allItems.filter((a) => getArtifactDocumentType(a) === 'Human Persona'),
            legacyDna: allItems.filter((a) => getArtifactDocumentType(a) === 'Legacy DNA'),
        }),
        [allItems],
    );

    return { ...result, companies, stakeholders, legacyDna, hasNextPage };
}
