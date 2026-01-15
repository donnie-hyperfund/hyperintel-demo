import type { TokenGetter } from './axios';
import { createChatApi } from './fetchers/chats';
import { createProjectApi } from './fetchers/projects';

export function createApiClient(getToken: TokenGetter) {
    return {
        projects: createProjectApi(getToken),
        chats: createChatApi(getToken),
    };
}

export type ApiClient = ReturnType<typeof createApiClient>;
