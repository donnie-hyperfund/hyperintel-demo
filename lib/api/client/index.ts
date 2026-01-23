import type { TokenGetter } from './axios';
import { createChatApi } from './fetchers/chats';
import { createMessageApi } from './fetchers/messages';
import { createProjectApi } from './fetchers/projects';

export function createApiClient(getToken: TokenGetter) {
    return {
        projects: createProjectApi(getToken),
        chats: createChatApi(getToken),
        messages: createMessageApi(getToken),
    };
}

export type ApiClient = ReturnType<typeof createApiClient>;
