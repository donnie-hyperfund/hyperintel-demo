import { useAuth } from '@clerk/nextjs';
import { useRef, useState } from 'react';
import useSWR, { type SWRConfiguration, useSWRConfig } from 'swr';
import useSWRInfinite, { type SWRInfiniteConfiguration } from 'swr/infinite';
import useSWRMutation from 'swr/mutation';
import { toast } from '@/hooks/use-toast';
import {
    createProjectArtifactApi,
    getProjectArtifactListInfiniteKey,
    type ProjectArtifactFilterParams,
    type ProjectArtifactListParams,
    projectArtifactKeys,
    serializeProjectArtifactListKey,
} from '@/lib/api/client/fetchers/project-artifacts';
import type {
    InfinitePaginationParams,
    PaginatedResponse,
    PaginationParams,
    UploadStatus,
} from '@/lib/api/client/types';
import { approveArtifact, rejectArtifact, uploadArtifact } from '@/lib/api/requests/worker/chat';
import { isKnownUploadError, UploadValidationError, validateArtifactFile } from '@/lib/artifacts/utils';
import type { ArtifactDto, UploadArtifactResponseDto } from '@/lib/schema/artifact';
import { ALLOWED_ARTIFACT_EXTENSIONS } from '@/lib/schema/artifact';

export function useFetchProjectArtifacts(
    projectId: string | undefined,
    params?: PaginationParams,
    config?: SWRConfiguration<PaginatedResponse<ArtifactDto>>,
) {
    const { getToken } = useAuth();

    return useSWR<PaginatedResponse<ArtifactDto>>(
        projectId ? projectArtifactKeys.list(projectId, params) : null,
        () => {
            if (!projectId) throw new Error('Project ID is required');
            return createProjectArtifactApi(getToken).list(projectId, params);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchProjectArtifactsInfinite(
    projectId: string | undefined,
    params: InfinitePaginationParams & ProjectArtifactFilterParams = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<ArtifactDto>>,
) {
    const { getToken } = useAuth();
    const { limit, ...filters } = params;

    const result = useSWRInfinite<PaginatedResponse<ArtifactDto>>(
        getProjectArtifactListInfiniteKey(projectId, limit, filters),
        (key) => {
            if (!projectId) throw new Error('Project ID is required');
            const params = key[key.length - 1] as ProjectArtifactListParams;
            return createProjectArtifactApi(getToken).list(projectId, params);
        },
        { revalidateOnFocus: false, ...config },
    );

    const lastPage = result.data?.[result.data.length - 1];
    const hasNextPage = lastPage ? lastPage.pagination.page < lastPage.pagination.totalPages : false;

    return { ...result, hasNextPage };
}

export function useFetchProjectArtifact(
    projectId: string | undefined,
    artifactId: string | undefined,
    config?: SWRConfiguration<ArtifactDto>,
) {
    const { getToken } = useAuth();

    return useSWR<ArtifactDto>(
        projectId && artifactId ? projectArtifactKeys.detail(projectId, artifactId) : null,
        () => {
            if (!projectId || !artifactId) throw new Error('Project ID and Artifact ID are required');
            return createProjectArtifactApi(getToken).get(projectId, artifactId);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchProjectArtifactByKey(
    projectId: string | undefined,
    key: string | undefined,
    config?: SWRConfiguration<ArtifactDto>,
) {
    const { getToken } = useAuth();

    return useSWR<ArtifactDto>(
        projectId && key ? projectArtifactKeys.byKey(projectId, key) : null,
        () => {
            if (!projectId || !key) throw new Error('Project ID and key are required');
            return createProjectArtifactApi(getToken).getByKey(projectId, key);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useApproveProjectArtifactVersion(projectId: string, artifactKey: string, artifactVersion: number) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<ArtifactDto, Error, readonly (string | undefined)[]>(
        [...projectArtifactKeys.byKey(projectId, artifactKey)],
        async () => {
            const api = createProjectArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, artifactKey, artifactVersion);
            if (!artifact.proposed_version) throw new Error('No proposed version');

            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const response = await approveArtifact({ versionId: artifact.proposed_version.id }, token);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to approve artifact');
            }

            globalMutate(serializeProjectArtifactListKey(projectId));
            return api.getByKey(projectId, artifactKey, artifactVersion);
        },
    );
}

export function useRejectProjectArtifactVersion(projectId: string, artifactKey: string, artifactVersion: number) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<ArtifactDto, Error, readonly (string | undefined)[], string>(
        [...projectArtifactKeys.byKey(projectId, artifactKey)],
        async (_, { arg: reason }) => {
            const api = createProjectArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, artifactKey, artifactVersion);
            if (!artifact.proposed_version) throw new Error('No proposed version');

            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const response = await rejectArtifact({ versionId: artifact.proposed_version.id, reason }, token);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to reject artifact');
            }

            globalMutate(serializeProjectArtifactListKey(projectId));
            return api.getByKey(projectId, artifactKey, artifactVersion);
        },
    );
}

export function useDeleteProjectArtifact(projectId: string, artifactKey: string) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<{ success: true; message: string }, Error, readonly (string | undefined)[]>(
        [...projectArtifactKeys.byKey(projectId, artifactKey), 'delete'],
        async () => {
            const api = createProjectArtifactApi(getToken);
            const artifact = await api.getByKey(projectId, artifactKey);
            const result = await api.delete(projectId, artifact.id);
            globalMutate(serializeProjectArtifactListKey(projectId));
            return result;
        },
    );
}

export function useUploadProjectArtifact(projectId: string, chatId: string | null) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [status, setStatus] = useState<UploadStatus>('idle');
    const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const uploadKey = projectId ? [...projectArtifactKeys.all, 'upload', projectId, chatId ?? 'project'] : null;

    const mutation = useSWRMutation<UploadArtifactResponseDto, Error, string[] | null, File>(
        uploadKey,
        async (_, { arg: file }) => {
            const validation = validateArtifactFile(file);
            if (validation) throw new UploadValidationError(validation.code, validation.message);

            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const response = await uploadArtifact({ file, projectId, chatId }, token);
            if (!response.ok) {
                const error = await response.json();
                // Only trust messages with codes we control — everything else is opaque
                if (isKnownUploadError(error.code)) {
                    throw new UploadValidationError(error.code, error.message);
                }
                throw new Error(error.message || 'Upload failed');
            }

            globalMutate(serializeProjectArtifactListKey(projectId));
            return response.json();
        },
    );

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setStatus('uploading');
            const result = await mutation.trigger(file);

            if (result) {
                setStatus('success');
                successTimeoutRef.current = setTimeout(() => setStatus('idle'), 1000);
                toast({
                    title:
                        result.action === 'new_version'
                            ? `Uploaded as v${result.version} of "${result.key}"`
                            : `Uploaded "${result.key}"`,
                });
            }
        } catch (err) {
            setStatus('idle');
            console.error('Upload failed:', err);

            toast({
                title: err instanceof UploadValidationError ? err.message : 'Something went wrong. Please try again.',
                variant: 'destructive',
            });
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return {
        fileInputRef,
        handleFileChange,
        status,
        accept: ALLOWED_ARTIFACT_EXTENSIONS.join(','),
    };
}
