import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration, useSWRConfig } from 'swr';
import useSWRInfinite, { type SWRInfiniteConfiguration } from 'swr/infinite';
import useSWRMutation from 'swr/mutation';
import type { CreateProjectBodyDto, ProjectDto, UpdateProjectBodyDto } from '@/lib/schema/project';
import { createProjectApi, getProjectListInfiniteKey, type ProjectListParams, projectKeys } from '../fetchers/projects';
import type { PaginatedResponse } from '../types';

export function useFetchProjects(params?: ProjectListParams, config?: SWRConfiguration<PaginatedResponse<ProjectDto>>) {
    const { getToken } = useAuth();

    return useSWR<PaginatedResponse<ProjectDto>>(
        projectKeys.list(params),
        () => createProjectApi(getToken).list(params),
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchProjectsInfinite(
    params: ProjectListParams = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<ProjectDto>>,
) {
    const { getToken } = useAuth();
    const { limit = 20, status } = params;

    const result = useSWRInfinite<PaginatedResponse<ProjectDto>>(
        getProjectListInfiniteKey(limit, status),
        (key) => {
            const params = key[key.length - 1] as ProjectListParams;
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
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<ProjectDto, Error, string, CreateProjectBodyDto>('create-project', async (_, { arg }) => {
        const project = await createProjectApi(getToken).create(arg);
        globalMutate((key) => typeof key === 'string' && key.includes('"projects"'));
        return project;
    });
}

export function useUpdateProject(projectId: string) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<ProjectDto, Error, readonly string[], UpdateProjectBodyDto>(
        [...projectKeys.detail(projectId)],
        async (_, { arg }) => {
            const project = await createProjectApi(getToken).update(projectId, arg);
            globalMutate((key) => typeof key === 'string' && key.includes('"projects"'));
            return project;
        },
    );
}

export function useDeleteProject(projectId: string) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<{ message: string }, Error, readonly string[]>(
        [...projectKeys.detail(projectId)],
        async () => {
            const result = await createProjectApi(getToken).delete(projectId);
            globalMutate((key) => typeof key === 'string' && key.includes('"projects"'));
            return result;
        },
    );
}
