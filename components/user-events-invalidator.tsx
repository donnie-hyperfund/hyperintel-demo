'use client';

import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { invalidateProjectLists } from '@/lib/api/client/fetchers/projects';
import { useUserEvents } from '@/modules/chat/hooks/use-user-events';

function cacheKeyIncludes(key: unknown, marker: string): boolean {
    if (typeof key === 'string') return key.includes(marker) || key.includes(`"${marker}"`);
    if (Array.isArray(key)) return key.some((part) => cacheKeyIncludes(part, marker));
    return false;
}

/**
 * Listens for user-scoped broadcast events and invalidates relevant SWR caches.
 * Must be rendered inside WebsocketProvider.
 */
export function UserEventsInvalidator() {
    const { mutate } = useSWRConfig();

    useUserEvents(
        useCallback(
            (eventType: string) => {
                switch (eventType) {
                    case 'artifact_version_created':
                    case 'artifact_version_updated':
                        void mutate((key: unknown) => cacheKeyIncludes(key, 'artifacts'));
                        break;
                    case 'chat_created':
                        void mutate((key: unknown) => cacheKeyIncludes(key, 'chats'));
                        break;
                    case 'project_created':
                    case 'project_archived':
                    case 'project_unarchived':
                    case 'project_deleted':
                        invalidateProjectLists(mutate);
                        break;
                    default:
                        break;
                }
            },
            [mutate],
        ),
    );

    return null;
}
