import { useAuth } from '@clerk/nextjs';
import { useRef, useState } from 'react';
import useSWR, { type SWRConfiguration, useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';
import { ZodError } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { artifactKeys, createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import type { PaginatedResponse, PaginationParams, UploadStatus } from '@/lib/api/client/types';
import { approveArtifact, rejectArtifact, uploadArtifact } from '@/lib/api/requests/worker/chat';
import { validateArtifactFile } from '@/lib/artifacts/utils';
import type { ArtifactDto, UploadArtifactResponseDto } from '@/lib/schema/artifact';
import { ALLOWED_ARTIFACT_EXTENSIONS, UploadArtifactResponseSchema } from '@/lib/schema/artifact';

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

export function useUploadArtifact(projectId: string, chatId: string | null) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [status, setStatus] = useState<UploadStatus>('idle');
    const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { toast } = useToast();

    const mutation = useSWRMutation<UploadArtifactResponseDto, Error, string[] | null, File>(
        projectId && chatId ? [...artifactKeys.all, 'upload', projectId, chatId] : null,
        async (_, { arg: file }) => {
            const validationError = validateArtifactFile(file);
            if (validationError) throw new Error(validationError);

            const token = await getToken();
            if (!token) throw new Error('Not authenticated');
            if (!chatId) throw new Error('No active chat');

            const response = await uploadArtifact({ file, projectId: projectId!, chatId }, token);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.message || 'Upload failed');
            }

            globalMutate(artifactKeys.list(projectId));
            const data = await response.json();
            return UploadArtifactResponseSchema.parse(data);
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
            console.error('Upload failed:', err);

            let title = 'Upload failed';

            if (err instanceof ZodError) {
                title = 'Unexpected server response. Please try again.';
            } else if (err instanceof Error) {
                title = err.message;
            }

            toast({
                title,
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
