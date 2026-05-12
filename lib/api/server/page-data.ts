import 'server-only';

import { cache } from 'react';
import { assertAuthPage } from '@/lib/api/auth-guard';
import { fetchChat, fetchIntakeChat, type IntakeFramework } from '@/lib/api/server/fetchers/chats';
import { fetchProject } from '@/lib/api/server/fetchers/projects';

export const getPageUser = cache(async () => assertAuthPage());

export const getProjectPageData = cache(async (projectId: string) => {
    const user = await getPageUser();
    const project = await fetchProject(projectId, user);

    return { user, project };
});

export const getChatPageData = cache(async (projectId: string, chatId: string) => {
    const { user, project } = await getProjectPageData(projectId);
    const chat = project ? await fetchChat(projectId, chatId, user) : null;

    return { user, project, chat };
});

export const getIntakeChatPageData = cache(async (chatId: string, framework: IntakeFramework) => {
    const user = await getPageUser();
    const chat = await fetchIntakeChat({ chatId, framework, user });

    return { user, chat };
});
