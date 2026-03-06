import type { TokenGetter } from './axios';
import { createArtifactApi } from './fetchers/artifacts';
import { createChatApi } from './fetchers/chats';
import { createMessageApi } from './fetchers/messages';
import { createProjectArtifactApi } from './fetchers/project-artifacts';
import { createProjectApi } from './fetchers/projects';

export function createApiClient(getToken: TokenGetter) {
    return {
        projects: createProjectApi(getToken),
        chats: createChatApi(getToken),
        messages: createMessageApi(getToken),
        artifacts: createArtifactApi(getToken),
        projectArtifacts: createProjectArtifactApi(getToken),
    };
}

export type ApiClient = ReturnType<typeof createApiClient>;
