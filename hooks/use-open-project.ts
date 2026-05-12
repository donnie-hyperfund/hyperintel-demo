import { useUser } from '@clerk/nextjs';
import { useRouter } from 'nextjs-toploader/app';
import { useCallback } from 'react';
import type { CamelCaseDto } from '@/lib/api/client/types';
import { setCurrentProjectCookie } from '@/lib/cookies/project';
import type { ProjectDto } from '@/lib/schema/project';

export function useOpenProject() {
    const router = useRouter();
    const { user } = useUser();

    const markProjectActive = useCallback(
        (project: CamelCaseDto<ProjectDto>) => {
            if (!user?.id) return;
            setCurrentProjectCookie(user.id, project.id);
        },
        [user?.id],
    );

    const openProject = useCallback(
        (project: CamelCaseDto<ProjectDto>) => {
            markProjectActive(project);
            router.push(`/${project.id}`);
        },
        [router, markProjectActive],
    );

    return { openProject, markProjectActive };
}
