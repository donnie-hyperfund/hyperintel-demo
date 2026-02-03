import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration, useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';
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

export function useApproveArtifactVersion(projectId: string, artifactKey: string) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<ArtifactDto, Error, readonly (string | undefined)[]>(
        [...artifactKeys.byKey(projectId, artifactKey)],
        async () => {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, artifactKey);
            if (!artifact.proposed_version) throw new Error('No proposed version');
            await api.approveVersion(projectId, artifact.id, artifact.proposed_version.id);
            globalMutate(artifactKeys.list(projectId));
            return api.getByKey(projectId, artifactKey);
        },
    );
}

export function useRejectArtifactVersion(projectId: string, artifactKey: string) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<ArtifactDto, Error, readonly (string | undefined)[], string>(
        [...artifactKeys.byKey(projectId, artifactKey)],
        async (_, { arg: reason }) => {
            const api = createArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, artifactKey);
            if (!artifact.proposed_version) throw new Error('No proposed version');
            await api.rejectVersion(projectId, artifact.id, artifact.proposed_version.id, reason);
            globalMutate(artifactKeys.list(projectId));
            return api.getByKey(projectId, artifactKey);
        },
    );
}
