import type { EntityManager } from '@mikro-orm/core';
import type { StreamEvent } from '@/lib/schema/stream';
import { UserEventType } from '@/lib/schema/user-events';
import type { ILockService } from '@/workers/_common/util/locks';
import type { Ctx } from '../context';
import { cleanupOrphanArtifact, countLines, type DocumentScope, type DraftManager } from '../tools/documents';
import { broadcastUserEvent } from './broadcast';

type CleanupActiveDraftReservationOptions = {
    stage: string;
    source: string;
    ctx: Ctx;
    em: EntityManager;
    lockService: ILockService;
    draftManager: DraftManager;
    chatId: string;
    scope: DocumentScope;
    streamLocation: {
        domain: 'chat' | 'intake';
        chatType: 'phase' | 'company' | 'stakeholder';
        projectId: string | null;
    };
    pushStreamEvents: (events: StreamEvent[]) => void;
    onEvent?: (event: StreamEvent) => void;
};

export async function cleanupActiveDraftReservation(opts: CleanupActiveDraftReservationOptions): Promise<void> {
    const {
        stage,
        source,
        ctx,
        em,
        lockService,
        draftManager,
        chatId,
        scope,
        streamLocation,
        pushStreamEvents,
        onEvent,
    } = opts;

    const draft = draftManager.getCurrent();
    if (!draft) return;

    const cleanupEvent: StreamEvent = {
        type: 'document_complete',
        artifactId: draft.artifactId,
        name: draft.name,
        lines: countLines(draft.content),
        action: 'aborted',
        status: 'aborted',
    };

    pushStreamEvents([cleanupEvent]);
    onEvent?.(cleanupEvent);
    void broadcastUserEvent(ctx, UserEventType.ArtifactStreamCompleted, {
        chatId,
        domain: streamLocation.domain,
        chatType: streamLocation.chatType,
        projectId: streamLocation.projectId,
        artifactId: draft.artifactId,
        artifactKey: draft.name,
    });

    await cleanupOrphanArtifact({ em, lockService, scope, name: draft.name }).catch((cleanupError) => {
        console.error(`[${source}] failed to cleanup active draft reservation after ${stage}:`, cleanupError);
    });
    draftManager.discard();
}
