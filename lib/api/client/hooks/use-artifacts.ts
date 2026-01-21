import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration } from 'swr';
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
