import { useAuth } from '@clerk/nextjs';
import { useMemo } from 'react';
import type { SWRInfiniteConfiguration } from 'swr/infinite';
import {
    createResourceApi,
    getResourceListInfiniteKey,
    type ResourceListParams,
} from '@/lib/api/client/fetchers/resources';
import type { CamelCaseDto, InfinitePaginationParams, PaginatedResponse } from '@/lib/api/client/types';
import { getArtifactDocumentType } from '@/lib/artifacts/utils';
import type { ArtifactDto, DocumentType, OwnershipFilter } from '@/lib/schema/artifact';
import { useSWRInfinitePaginated } from './use-swr-infinite-paginated';

export function useFetchResources(
    params: InfinitePaginationParams & {
        approvedOnly?: boolean;
        documentType?: DocumentType[];
        excludeProjectId?: string;
        search?: string;
        ownership?: OwnershipFilter;
    } = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<CamelCaseDto<ArtifactDto>>>,
) {
    const { getToken } = useAuth();
    const { limit, approvedOnly, documentType, excludeProjectId, search, ownership } = params;

    const result = useSWRInfinitePaginated<CamelCaseDto<ArtifactDto>>(
        getResourceListInfiniteKey({ limit, approvedOnly, documentType, excludeProjectId, search, ownership }),
        (key) => {
            const pageParams = key[key.length - 1] as ResourceListParams;
            return createResourceApi(getToken).list(pageParams);
        },
        { revalidateOnFocus: false, ...config },
    );

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

    return { ...result, companies, stakeholders, legacyDna };
}
