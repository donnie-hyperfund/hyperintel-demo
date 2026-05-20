import { useFetchProjects } from './use-projects';

export const RECENT_PROJECTS_LIMIT = 6;

export function useRecentProjects() {
    const { data, isLoading, error } = useFetchProjects({
        page: 1,
        limit: RECENT_PROJECTS_LIMIT,
        status: 'active',
    });

    return {
        projects: data?.data ?? [],
        total: data?.pagination.total ?? 0,
        isLoading,
        error,
    };
}
