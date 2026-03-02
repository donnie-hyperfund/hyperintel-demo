import { useAuth } from '@clerk/nextjs';
import { useMemo } from 'react';
import useSWRInfinite, { type SWRInfiniteConfiguration } from 'swr/infinite';
import {
    createProjectResourceApi,
    getProjectResourceListInfiniteKey,
    type ProjectResourceListParams,
} from '@/lib/api/client/fetchers/project-resources';
import type { InfinitePaginationParams, PaginatedResponse } from '@/lib/api/client/types';
import type { ArtifactDto } from '@/lib/schema/artifact';

function getDocType(a: ArtifactDto) {
    return a.current_version?.document_type ?? a.proposed_version?.document_type;
}

export function useFetchProjectResources(
    projectId: string,
    params: InfinitePaginationParams = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<ArtifactDto>>,
) {
    const { getToken } = useAuth();

    const result = useSWRInfinite<PaginatedResponse<ArtifactDto>>(
        getProjectResourceListInfiniteKey(projectId, params.limit),
        (key) => {
            const pageParams = key[key.length - 1] as ProjectResourceListParams;
            return createProjectResourceApi(getToken).list(projectId, pageParams);
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
            companies: allItems.filter((a) => getDocType(a) === 'Company Profile'),
            stakeholders: allItems.filter((a) => getDocType(a) === 'Human Persona'),
            legacyDna: allItems.filter((a) => getDocType(a) === 'Legacy DNA'),
        }),
        [allItems],
    );

    return { ...result, allItems, companies, stakeholders, legacyDna, hasNextPage };
}
