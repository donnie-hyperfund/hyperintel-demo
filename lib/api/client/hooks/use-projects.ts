import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration } from 'swr';
import useSWRMutation from 'swr/mutation';
import type { CreateProjectBodyDto, ProjectDto, UpdateProjectBodyDto } from '@/lib/schema/project';
import { createProjectApi, projectKeys } from '../fetchers/projects';
import type { PaginatedResponse, PaginationParams } from '../types';

export function useFetchProjects(params?: PaginationParams, config?: SWRConfiguration<PaginatedResponse<ProjectDto>>) {
    const { getToken } = useAuth();

    return useSWR<PaginatedResponse<ProjectDto>>(
        projectKeys.list(params),
        () => createProjectApi(getToken).list(params),
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchProject(projectId: string | undefined, config?: SWRConfiguration<ProjectDto>) {
    const { getToken } = useAuth();

    return useSWR<ProjectDto>(
        projectId ? projectKeys.detail(projectId) : null,
        () => {
            if (!projectId) throw new Error('Project ID is required');
            return createProjectApi(getToken).get(projectId);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useCreateProject() {
    const { getToken } = useAuth();

    return useSWRMutation<ProjectDto, Error, string, CreateProjectBodyDto>('create-project', (_, { arg }) =>
        createProjectApi(getToken).create(arg),
    );
}

export function useUpdateProject(projectId: string) {
    const { getToken } = useAuth();

    return useSWRMutation<ProjectDto, Error, readonly string[], UpdateProjectBodyDto>(
        [...projectKeys.detail(projectId)],
        (_, { arg }) => createProjectApi(getToken).update(projectId, arg),
    );
}

export function useDeleteProject(projectId: string) {
    const { getToken } = useAuth();

    return useSWRMutation<{ message: string }, Error, readonly string[]>([...projectKeys.detail(projectId)], () =>
        createProjectApi(getToken).delete(projectId),
    );
}
