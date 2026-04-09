import { useAuth } from '@clerk/nextjs';
import useSWR, { type SWRConfiguration, useSWRConfig } from 'swr';
import type { SWRInfiniteConfiguration } from 'swr/infinite';
import useSWRMutation from 'swr/mutation';
import type { CreateProjectBodyDto, ProjectDto, UpdateProjectBodyDto } from '@/lib/schema/project';
import {
    createProjectApi,
    getProjectListInfiniteKey,
    invalidateProjectLists,
    type ProjectListParams,
    projectKeys,
} from '../fetchers/projects';
import type { CamelCaseDto, PaginatedResponse } from '../types';
import { useSWRInfinitePaginated } from './use-swr-infinite-paginated';

export function useFetchProjects(
    params?: ProjectListParams,
    config?: SWRConfiguration<PaginatedResponse<CamelCaseDto<ProjectDto>>>,
) {
    const { getToken } = useAuth();

    return useSWR<PaginatedResponse<CamelCaseDto<ProjectDto>>>(
        projectKeys.list(params),
        () => createProjectApi(getToken).list(params),
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchProjectsInfinite(
    params: ProjectListParams = { limit: 20 },
    config?: SWRInfiniteConfiguration<PaginatedResponse<CamelCaseDto<ProjectDto>>>,
) {
    const { getToken } = useAuth();
    const { status, limit = 20 } = params;

    return useSWRInfinitePaginated<CamelCaseDto<ProjectDto>>(
        getProjectListInfiniteKey(status, limit),
        (key) => {
            const params = key[key.length - 1] as ProjectListParams;
            return createProjectApi(getToken).list(params);
        },
        { revalidateOnFocus: false, ...config },
    );
}

export function useFetchProject(projectId: string | undefined, config?: SWRConfiguration<CamelCaseDto<ProjectDto>>) {
    const { getToken } = useAuth();

    return useSWR<CamelCaseDto<ProjectDto>>(
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

    return useSWRMutation<CamelCaseDto<ProjectDto>, Error, string, CreateProjectBodyDto>(
        'create-project',
        async (_, { arg }) => {
            const project = await createProjectApi(getToken).create(arg);
            invalidateProjectLists(globalMutate);
            return project;
        },
    );
}

export function useUpdateProject(projectId: string) {
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();

    return useSWRMutation<CamelCaseDto<ProjectDto>, Error, readonly string[], UpdateProjectBodyDto>(
        [...projectKeys.detail(projectId)],
        async (_, { arg }) => {
            const project = await createProjectApi(getToken).update(projectId, arg);
            invalidateProjectLists(globalMutate, arg.archived !== undefined ? projectId : undefined);
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
            invalidateProjectLists(globalMutate, projectId);
            return result;
        },
    );
}
