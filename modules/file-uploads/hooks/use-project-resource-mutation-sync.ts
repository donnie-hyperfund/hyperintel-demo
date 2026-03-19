'use client';

import { useCallback } from 'react';
import { UserEventType } from '@/lib/schema/user-events';
import { useUserEvents } from '@/modules/chat/hooks/use-user-events';

/** Event types that should trigger a project resource list re-fetch on other tabs. */
const INVALIDATION_EVENTS = new Set<string>([
    UserEventType.ProjectResourceDeleted,
    UserEventType.ProjectResourceImported,
]);

/**
 * Cross-tab sync: re-fetches the project resource list when another tab
 * deletes or imports resources.
 */
export function useProjectResourceMutationSync(projectId: string | undefined, onInvalidate: () => void) {
    const handleEvent = useCallback(
        (eventType: string, payload: unknown) => {
            if (!projectId || !INVALIDATION_EVENTS.has(eventType)) return;

            const parsed = payload as { projectId?: string } | null;
            if (parsed?.projectId !== projectId) return;

            onInvalidate();
        },
        [onInvalidate, projectId],
    );

    useUserEvents(handleEvent);
}
