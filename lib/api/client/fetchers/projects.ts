import type { ScopedMutator } from 'swr';
import { unstable_serialize } from 'swr/infinite';
import type { CreateProjectBodyDto, ProjectDto, ProjectListStatus, UpdateProjectBodyDto } from '@/lib/schema/project';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { CamelCaseDto, PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: '/api/projects',
    byId: (id: string) => `/api/projects/${id}`,
} as const;

export const projectKeys = {
    all: ['projects'] as const,
    lists: () => [...projectKeys.all, 'list'] as const,
    list: (params?: ProjectListParams) => [...projectKeys.lists(), params] as const,
    details: () => [...projectKeys.all, 'detail'] as const,
    detail: (id: string) => [...projectKeys.details(), id] as const,
};

export type ProjectListParams = PaginationParams & {
    status?: ProjectListStatus;
};

export function getProjectListInfiniteKey(status?: ProjectListStatus, limit = 20) {
    return (pageIndex: number, previousPageData: PaginatedResponse<CamelCaseDto<ProjectDto>> | null) => {
        if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
        return projectKeys.list({ page: pageIndex + 1, limit, status });
    };
}

export function serializeProjectListKey(status?: ProjectListStatus, limit = 20) {
    return unstable_serialize(getProjectListInfiniteKey(status, limit));
}

export function invalidateProjectLists(globalMutate: ScopedMutator) {
    globalMutate(serializeProjectListKey('active'));
    globalMutate(serializeProjectListKey('archived'));
    globalMutate((key: unknown) => Array.isArray(key) && key[0] === projectKeys.all[0] && key[1] === 'list');
}

export function createProjectApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (params?: ProjectListParams) => {
            const { data } = await axios.get<PaginatedResponse<CamelCaseDto<ProjectDto>>>(
                buildUrl(ENDPOINTS.root, params as Record<string, string | number | undefined>),
            );
            return data;
        },

        get: async (id: string) => {
            const { data } = await axios.get<CamelCaseDto<ProjectDto>>(ENDPOINTS.byId(id));
            return data;
        },

        create: async (body: CreateProjectBodyDto) => {
            const { data } = await axios.post<CamelCaseDto<ProjectDto>>(ENDPOINTS.root, body);
            return data;
        },

        update: async (id: string, body: UpdateProjectBodyDto) => {
            const { data } = await axios.patch<CamelCaseDto<ProjectDto>>(ENDPOINTS.byId(id), body);
            return data;
        },

        delete: async (id: string) => {
            const { data } = await axios.delete<{ message: string }>(ENDPOINTS.byId(id));
            return data;
        },
    };
}

export type ProjectApi = ReturnType<typeof createProjectApi>;
