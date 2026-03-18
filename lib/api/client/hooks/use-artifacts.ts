import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration, useSWRConfig } from 'swr';
import type { SWRInfiniteConfiguration } from 'swr/infinite';
import useSWRMutation from 'swr/mutation';
import { artifactKeys, createArtifactApi, getArtifactListInfiniteKey } from '@/lib/api/client/fetchers/artifacts';
import { resourceKeys } from '@/lib/api/client/fetchers/resources';
import type { InfinitePaginationParams, PaginatedResponse, PaginationParams } from '@/lib/api/client/types';
import { approveArtifact, rejectArtifact } from '@/lib/api/requests/worker/chat';
import type { ArtifactDto, DocumentType } from '@/lib/schema/artifact';
import { useSWRInfinitePaginated } from './use-swr-infinite-paginated';

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

    return useSWRInfinitePaginated<ArtifactDto>(
        getArtifactListInfiniteKey(documentType, params.limit),
        (key) => {
            if (!documentType) throw new Error('Document type is required');
            const params = key[key.length - 1] as PaginationParams;
            return createArtifactApi(getToken).list(documentType, params);
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

    return useSWRMutation<ArtifactDto, Error, readonly string[]>(
        [...artifactKeys.all, 'approve', artifactKey, String(artifactVersion)],
        async () => {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(artifactKey, artifactVersion);
            if (!artifact.proposed_version) throw new Error('No proposed version');

            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const response = await approveArtifact({ versionId: artifact.proposed_version.id }, token);
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

    return useSWRMutation<ArtifactDto, Error, readonly string[], string>(
        [...artifactKeys.all, 'reject', artifactKey, String(artifactVersion)],
        async (_, { arg: reason }) => {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(artifactKey, artifactVersion);
            if (!artifact.proposed_version) throw new Error('No proposed version');

            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const response = await rejectArtifact({ versionId: artifact.proposed_version.id, reason }, token);
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
