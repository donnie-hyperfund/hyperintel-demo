import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration, useSWRConfig } from 'swr';
import type { SWRInfiniteConfiguration } from 'swr/infinite';
import useSWRMutation from 'swr/mutation';
import {
    type ArtifactListFilterParams,
    artifactKeys,
    createArtifactApi,
    getArtifactListInfiniteKey,
} from '@/lib/api/client/fetchers/artifacts';
import { resourceKeys } from '@/lib/api/client/fetchers/resources';
import type {
    CamelCaseDto,
    InfinitePaginationParams,
    PaginatedResponse,
    PaginationParams,
} from '@/lib/api/client/types';
import { approveArtifact, rejectArtifact } from '@/lib/api/requests/worker/chat';
import type { ArtifactDto, DocumentType } from '@/lib/schema/artifact';
import { useSWRInfinitePaginated } from './use-swr-infinite-paginated';

export function useFetchArtifacts(
    documentType: DocumentType | undefined,
    params?: PaginationParams,
    config?: SWRConfiguration<PaginatedResponse<CamelCaseDto<ArtifactDto>>>,
) {
    const { getToken } = useAuth();

    return useSWR<PaginatedResponse<CamelCaseDto<ArtifactDto>>>(
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
    params: InfinitePaginationParams & ArtifactListFilterParams = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<CamelCaseDto<ArtifactDto>>>,
) {
    const { getToken } = useAuth();
    const { search, ownership, limit } = params;

    return useSWRInfinitePaginated<CamelCaseDto<ArtifactDto>>(
        getArtifactListInfiniteKey({ documentType, limit, search, ownership }),
        (key) => {
            if (!documentType) throw new Error('Document type is required');
            const pageParams = key[key.length - 1] as PaginationParams & ArtifactListFilterParams;
            return createArtifactApi(getToken).list(documentType, pageParams);
        },
        { revalidateOnFocus: false, ...config },
    );
}

function invalidateUserArtifactCaches(globalMutate: ReturnType<typeof useSWRConfig>['mutate']) {
    globalMutate((key) => Array.isArray(key) && key[0] === artifactKeys.all[0]);
    globalMutate((key) => Array.isArray(key) && key[0] === resourceKeys.all[0]);
}

/** Approve a proposed version on a user-scoped artifact (intake chats). */
export function useApproveUserArtifactVersion(artifactKey: string, artifactVersion: number) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<CamelCaseDto<ArtifactDto>, Error, readonly string[]>(
        [...artifactKeys.all, 'approve', artifactKey, String(artifactVersion)],
        async () => {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(artifactKey, artifactVersion);
            if (!artifact.proposedVersion) throw new Error('No proposed version');

            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const response = await approveArtifact({ versionId: artifact.proposedVersion.id }, token);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to approve artifact');
            }

            invalidateUserArtifactCaches(globalMutate);
            return api.getByKey(artifactKey, artifactVersion);
        },
    );
}

/** Reject a proposed version on a user-scoped artifact (intake chats). */
export function useRejectUserArtifactVersion(artifactKey: string, artifactVersion: number) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<CamelCaseDto<ArtifactDto>, Error, readonly string[], string>(
        [...artifactKeys.all, 'reject', artifactKey, String(artifactVersion)],
        async (_, { arg: reason }) => {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(artifactKey, artifactVersion);
            if (!artifact.proposedVersion) throw new Error('No proposed version');

            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const response = await rejectArtifact({ versionId: artifact.proposedVersion.id, reason }, token);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to reject artifact');
            }

            invalidateUserArtifactCaches(globalMutate);
            return api.getByKey(artifactKey, artifactVersion);
        },
    );
}

export function useDeleteArtifact(artifactId: string) {
    const { getToken } = useAuth();

    return useSWRMutation<{ success: true; message: string }, Error, readonly string[]>(
        [...artifactKeys.all, artifactId, 'delete'],
        () => createArtifactApi(getToken).delete(artifactId),
    );
}
