'use client';

import { useCallback } from 'react';
import {
    type ProjectResourceUploadUpdatedPayload,
    ProjectResourceUploadUpdatedPayloadSchema,
    UserEventType,
} from '@/lib/schema/user-events';
import { useUserEvents } from '@/modules/chat/hooks/use-user-events';

export function useProjectResourceUploadSync(
    projectId: string | undefined,
    onUploadUpdate: (payload: ProjectResourceUploadUpdatedPayload) => void,
) {
    const handleEvent = useCallback(
        (eventType: string, payload: unknown) => {
            if (!projectId || eventType !== UserEventType.ProjectResourceUploadUpdated) return;

            const parsed = ProjectResourceUploadUpdatedPayloadSchema.safeParse(payload);
            if (!parsed.success || parsed.data.projectId !== projectId) return;

            onUploadUpdate(parsed.data);
        },
        [onUploadUpdate, projectId],
    );

    useUserEvents(handleEvent);
}
