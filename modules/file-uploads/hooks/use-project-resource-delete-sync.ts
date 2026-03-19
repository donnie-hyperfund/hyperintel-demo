'use client';

import { useCallback } from 'react';
import {
    type ProjectResourceDeletedPayload,
    ProjectResourceDeletedPayloadSchema,
    UserEventType,
} from '@/lib/schema/user-events';
import { useUserEvents } from '@/modules/chat/hooks/use-user-events';

export function useProjectResourceDeleteSync(
    projectId: string | undefined,
    onDelete: (payload: ProjectResourceDeletedPayload) => void,
) {
    const handleEvent = useCallback(
        (eventType: string, payload: unknown) => {
            if (!projectId || eventType !== UserEventType.ProjectResourceDeleted) return;

            const parsed = ProjectResourceDeletedPayloadSchema.safeParse(payload);
            if (!parsed.success || parsed.data.projectId !== projectId) return;

            onDelete(parsed.data);
        },
        [onDelete, projectId],
    );

    useUserEvents(handleEvent);
}
