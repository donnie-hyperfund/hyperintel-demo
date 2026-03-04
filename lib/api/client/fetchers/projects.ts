import type { CreateProjectBodyDto, ProjectDto, UpdateProjectBodyDto } from '@/lib/schema/project';
import { buildUrl, createAxiosInstance, type TokenGetter } from '../axios';
import type { PaginatedResponse, PaginationParams } from '../types';

const ENDPOINTS = {
    root: '/api/projects',
    byId: (id: string) => `/api/projects/${id}`,
} as const;

export const projectKeys = {
    all: ['projects'] as const,
    lists: () => [...projectKeys.all, 'list'] as const,
    list: (params?: PaginationParams) => [...projectKeys.lists(), params] as const,
    details: () => [...projectKeys.all, 'detail'] as const,
    detail: (id: string) => [...projectKeys.details(), id] as const,
};

export function getProjectListInfiniteKey(limit = 20) {
    return (pageIndex: number, previousPageData: PaginatedResponse<ProjectDto> | null) => {
        if (previousPageData && pageIndex >= previousPageData.pagination.totalPages) return null;
        return projectKeys.list({ page: pageIndex + 1, limit });
    };
}

export function createProjectApi(getToken: TokenGetter) {
    const axios = createAxiosInstance(getToken);

    return {
        list: async (params?: PaginationParams) => {
            const { data } = await axios.get<PaginatedResponse<ProjectDto>>(
                buildUrl(ENDPOINTS.root, params as Record<string, string | number | undefined>),
            );
            return data;
        },

        get: async (id: string) => {
            const { data } = await axios.get<ProjectDto>(ENDPOINTS.byId(id));
            return data;
        },

        create: async (body: CreateProjectBodyDto) => {
            const { data } = await axios.post<ProjectDto>(ENDPOINTS.root, body);
            return data;
        },

        update: async (id: string, body: UpdateProjectBodyDto) => {
            const { data } = await axios.patch<ProjectDto>(ENDPOINTS.byId(id), body);
            return data;
        },

        delete: async (id: string) => {
            const { data } = await axios.delete<{ message: string }>(ENDPOINTS.byId(id));
            return data;
        },
    };
}

export type ProjectApi = ReturnType<typeof createProjectApi>;
