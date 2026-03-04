import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration } from 'swr';
import useSWRInfinite, { type SWRInfiniteConfiguration } from 'swr/infinite';
import useSWRMutation from 'swr/mutation';
import type { CreateProjectBodyDto, ProjectDto, UpdateProjectBodyDto } from '@/lib/schema/project';
import { createProjectApi, getProjectListInfiniteKey, projectKeys } from '../fetchers/projects';
import type { InfinitePaginationParams, PaginatedResponse, PaginationParams } from '../types';

export function useFetchProjects(params?: PaginationParams, config?: SWRConfiguration<PaginatedResponse<ProjectDto>>) {
    const { getToken } = useAuth();

    return useSWR<PaginatedResponse<ProjectDto>>(
        projectKeys.list(params),
        () => createProjectApi(getToken).list(params),
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchProjectsInfinite(
    params: InfinitePaginationParams = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<ProjectDto>>,
) {
    const { getToken } = useAuth();

    const result = useSWRInfinite<PaginatedResponse<ProjectDto>>(
        getProjectListInfiniteKey(params.limit),
        (key) => {
            const params = key[key.length - 1] as PaginationParams;
            return createProjectApi(getToken).list(params);
        },
        { revalidateOnFocus: false, ...config },
    );

    const lastPage = result.data?.[result.data.length - 1];
    const hasNextPage = lastPage ? lastPage.pagination.page < lastPage.pagination.totalPages : false;

    return { ...result, hasNextPage };
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
