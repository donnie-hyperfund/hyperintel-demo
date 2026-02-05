import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration, useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';
import { approveArtifact, rejectArtifact } from '@/lib/api/requests/worker/chat';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { artifactKeys, createArtifactApi } from '../fetchers/artifacts';
import type { PaginatedResponse, PaginationParams } from '../types';

export function useFetchArtifacts(
    projectId: string | undefined,
    params?: PaginationParams,
    config?: SWRConfiguration<PaginatedResponse<ArtifactDto>>,
) {
    const { getToken } = useAuth();

    return useSWR<PaginatedResponse<ArtifactDto>>(
        projectId ? artifactKeys.list(projectId, params) : null,
        () => {
            if (!projectId) throw new Error('Project ID is required');
            return createArtifactApi(getToken).list(projectId, params);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchArtifact(
    projectId: string | undefined,
    artifactId: string | undefined,
    config?: SWRConfiguration<ArtifactDto>,
) {
    const { getToken } = useAuth();

    return useSWR<ArtifactDto>(
        projectId && artifactId ? artifactKeys.detail(projectId, artifactId) : null,
        () => {
            if (!projectId || !artifactId) throw new Error('Project ID and Artifact ID are required');
            return createArtifactApi(getToken).get(projectId, artifactId);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchArtifactByKey(
    projectId: string | undefined,
    key: string | undefined,
    config?: SWRConfiguration<ArtifactDto>,
) {
    const { getToken } = useAuth();

    return useSWR<ArtifactDto>(
        projectId && key ? artifactKeys.byKey(projectId, key) : null,
        () => {
            if (!projectId || !key) throw new Error('Project ID and key are required');
            return createArtifactApi(getToken).getByKey(projectId, key);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useApproveArtifactVersion(projectId: string, artifactKey: string, artifactVersion: number) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<ArtifactDto, Error, readonly (string | undefined)[]>(
        [...artifactKeys.byKey(projectId, artifactKey)],
        async () => {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, artifactKey, artifactVersion);
            if (!artifact.proposed_version) throw new Error('No proposed version');

            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const response = await approveArtifact({ versionId: artifact.proposed_version.id }, token);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to approve artifact');
            }

            globalMutate(artifactKeys.list(projectId));
            return api.getByKey(projectId, artifactKey, artifactVersion);
        },
    );
}

export function useRejectArtifactVersion(projectId: string, artifactKey: string, artifactVersion: number) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<ArtifactDto, Error, readonly (string | undefined)[], string>(
        [...artifactKeys.byKey(projectId, artifactKey)],
        async (_, { arg: reason }) => {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, artifactKey, artifactVersion);
            if (!artifact.proposed_version) throw new Error('No proposed version');

            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const response = await rejectArtifact({ versionId: artifact.proposed_version.id, reason }, token);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to reject artifact');
            }

            globalMutate(artifactKeys.list(projectId));
            return api.getByKey(projectId, artifactKey, artifactVersion);
        },
    );
}
