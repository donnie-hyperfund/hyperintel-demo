'use client';

import { useAuth } from '@clerk/nextjs';
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from 'react';
import { createArtifactApi } from '@/lib/api/client/fetchers/artifacts';
import { createProjectArtifactApi } from '@/lib/api/client/fetchers/project-artifacts';
import type { VersionStatus } from '@/lib/schema/artifact';
import {
    safeGetJsonItem as sessionGetJson,
    safeRemoveItem as sessionRemove,
    safeSetJsonItem as sessionSetJson,
} from '@/lib/storage/session-storage';
import { ARTIFACT_PROCESSING_KEY, NUDGE_PENDING_KEY } from '@/lib/storage/storage-keys';
import { useUserEvents } from '@/modules/chat/hooks/use-user-events';
import {
    clampProgress,
    completeOperation,
    failOperation,
    mergeProgressEvent,
    mergeStartedEvent,
    pruneExpiredOperations,
    removeOperation,
    startOperation,
} from './processing-state';
import type { ProcessingAction, ProcessingEntry, ProcessingEntryInput, ProcessingStage } from './types';

const AUTO_DISMISS_MS = 3000;
const STALE_THRESHOLD_MS = 10 * 60_000;

const ACTION_SUCCESS_STATUS: Record<ProcessingAction, string> = {
    approve: 'approved',
    reject: 'rejected',
    restore: 'proposed',
};

type CompletionPatch = Partial<ProcessingEntry>;

type VersionStatusReconciliationInput = {
    versionId: string;
    status?: VersionStatus | null;
};

type ArtifactProcessingContextValue = {
    startProcessing: (entry: ProcessingEntryInput) => void;
    failProcessing: (versionId: string) => void;
    completeProcessing: (versionId: string, patch?: CompletionPatch) => void;
    reconcileVersionStatus: (input: VersionStatusReconciliationInput) => void;
    isProcessing: (versionId: string) => boolean;
    hasEntry: (versionId: string) => boolean;
    getEntry: (versionId: string) => ProcessingEntry | undefined;
    activeEntries: ProcessingEntry[];
    visibleEntries: ProcessingEntry[];
    isAnyActionProcessing: (action: ProcessingAction) => boolean;
    hasPendingNudge: (chatId: string) => boolean;
    clearPendingNudge: (chatId: string) => void;
    suppressVersion: (versionId: string | null) => void;
    /** Returns true on first call for a given projectId (project entry), false on subsequent calls (phase switch). */
    checkProjectEntry: (projectId: string) => boolean;
};

const ArtifactProcessingContext = createContext<ArtifactProcessingContextValue | null>(null);

type WsEventPayload = {
    artifactId?: string;
    artifactName?: string;
    versionId?: string;
    version?: number;
    sourceVersionNumber?: number;
    restoredVersionNumber?: number;
    action?: ProcessingAction;
    previousStatus?: string;
    status?: string;
    nextStatus?: string;
    progress?: number;
    stage?: ProcessingStage;
    projectId?: string;
    projectName?: string;
    phaseName?: string;
    phaseIndex?: number;
    chatId?: string;
};

type ProcessingEntriesAction =
    | { type: 'start'; entry: ProcessingEntryInput; now: number }
    | { type: 'started-event'; entry: ProcessingEntry | null; now: number }
    | {
          type: 'progress-event';
          versionId: string;
          progress?: number;
          stage?: ProcessingStage;
          fallbackEntry?: ProcessingEntry | null;
          now: number;
      }
    | {
          type: 'complete';
          versionId: string;
          patch?: CompletionPatch;
          fallbackEntry?: ProcessingEntry | null;
          now: number;
      }
    | { type: 'fail'; versionId: string; patch?: CompletionPatch; fallbackEntry?: ProcessingEntry | null; now: number }
    | { type: 'remove'; versionId: string }
    | { type: 'prune-expired'; now: number; thresholdMs: number }
    | { type: 'reconcile-version-status'; versionId: string; status?: VersionStatus | null; now: number };

function loadFromStorage(): Map<string, ProcessingEntry> {
    const entries = sessionGetJson<ProcessingEntry[]>(ARTIFACT_PROCESSING_KEY);
    if (!entries) return new Map();
    return new Map(
        entries
            .filter((entry) => entry.status === 'processing')
            .map((entry) => {
                const processingEntry: ProcessingEntry & { displayProgress?: number } = { ...entry };
                delete processingEntry.displayProgress;
                return [processingEntry.versionId, processingEntry as ProcessingEntry];
            }),
    );
}

function saveToStorage(entries: Map<string, ProcessingEntry>) {
    const activeEntries = Array.from(entries.values()).filter((entry) => entry.status === 'processing');

    if (activeEntries.length === 0) {
        sessionRemove(ARTIFACT_PROCESSING_KEY);
    } else {
        sessionSetJson(ARTIFACT_PROCESSING_KEY, activeEntries);
    }
}

function loadPendingNudges(): Set<string> {
    const ids = sessionGetJson<string[]>(NUDGE_PENDING_KEY);
    return new Set(ids ?? []);
}

function savePendingNudges(ids: Set<string>) {
    if (ids.size === 0) {
        sessionRemove(NUDGE_PENDING_KEY);
    } else {
        sessionSetJson(NUDGE_PENDING_KEY, Array.from(ids));
    }
}

function buildEntryFromEvent(event: WsEventPayload, now: number): ProcessingEntry | null {
    const progress = clampProgress(event.progress);
    const base = {
        versionId: event.versionId!,
        artifactId: event.artifactId ?? '',
        artifactName: event.artifactName ?? '',
        status: 'processing' as const,
        projectId: event.projectId,
        projectName: event.projectName,
        phaseName: event.phaseName ?? undefined,
        phaseIndex: event.phaseIndex,
        chatId: event.chatId,
        startedAt: now,
        ...(progress != null ? { progress } : {}),
        ...(event.stage ? { stage: event.stage, stageStartedAt: now } : {}),
        hasObservedAiContentStage: event.stage === 'generating-ai-content',
        initiatedLocally: false,
    };

    if (event.action === 'restore') {
        return { ...base, action: 'restore', sourceVersionNumber: event.sourceVersionNumber ?? 0 };
    }
    if (event.action === 'approve' || event.action === 'reject') {
        return { ...base, action: event.action, artifactVersion: event.version ?? 0 };
    }
    return null;
}

function processingEntriesReducer(
    entries: Map<string, ProcessingEntry>,
    action: ProcessingEntriesAction,
): Map<string, ProcessingEntry> {
    switch (action.type) {
        case 'start':
            return startOperation({ entries, input: action.entry, now: action.now });
        case 'started-event':
            return mergeStartedEvent({ entries, incoming: action.entry, now: action.now });
        case 'progress-event':
            return mergeProgressEvent({
                entries,
                versionId: action.versionId,
                progress: action.progress,
                stage: action.stage,
                fallbackEntry: action.fallbackEntry,
                now: action.now,
            });
        case 'complete':
            return completeOperation({
                entries,
                versionId: action.versionId,
                patch: action.patch,
                fallbackEntry: action.fallbackEntry,
                now: action.now,
            });
        case 'fail':
            return failOperation({
                entries,
                versionId: action.versionId,
                patch: action.patch,
                fallbackEntry: action.fallbackEntry,
                now: action.now,
            });
        case 'remove':
            return removeOperation({ entries, versionId: action.versionId });
        case 'prune-expired':
            return pruneExpiredOperations({ entries, now: action.now, thresholdMs: action.thresholdMs });
        case 'reconcile-version-status': {
            if (!action.status || action.status === 'proposed') return entries;

            const entry = entries.get(action.versionId);
            if (!entry || entry.status !== 'processing') return entries;
            if (entry.action !== 'approve' && entry.action !== 'reject') return entries;

            return completeOperation({ entries, versionId: action.versionId, now: action.now });
        }
        default:
            return entries;
    }
}

export function ArtifactProcessingProvider({ children }: { children: ReactNode }) {
    const { getToken } = useAuth();
    const [entries, dispatchEntries] = useReducer(processingEntriesReducer, undefined, loadFromStorage);
    const [suppressedVersionId, setSuppressedVersionId] = useState<string | null>(null);
    const [pendingNudgeChatIds, setPendingNudgeChatIds] = useState<Set<string>>(() => loadPendingNudges());
    const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const nudgedCompletionIdsRef = useRef<Set<string>>(new Set());
    const lastEnteredProjectRef = useRef<string | null>(null);

    const allEntries = useMemo(() => Array.from(entries.values()), [entries]);
    const activeEntries = useMemo(() => allEntries.filter((entry) => entry.status === 'processing'), [allEntries]);
    const visibleEntries = useMemo(
        () => allEntries.filter((entry) => entry.versionId !== suppressedVersionId),
        [allEntries, suppressedVersionId],
    );

    const startProcessing = useCallback((entry: ProcessingEntryInput) => {
        dispatchEntries({ type: 'start', entry, now: Date.now() });
    }, []);

    const failProcessing = useCallback((versionId: string) => {
        dispatchEntries({ type: 'fail', versionId, now: Date.now() });
    }, []);

    const completeProcessing = useCallback((versionId: string, patch?: CompletionPatch) => {
        dispatchEntries({ type: 'complete', versionId, patch, now: Date.now() });
    }, []);

    const reconcileVersionStatus = useCallback(({ versionId, status }: VersionStatusReconciliationInput) => {
        dispatchEntries({ type: 'reconcile-version-status', versionId, status, now: Date.now() });
    }, []);

    const isProcessing = useCallback(
        (versionId: string) => {
            const entry = entries.get(versionId);
            return entry?.status === 'processing';
        },
        [entries],
    );

    const hasEntry = useCallback((versionId: string) => entries.has(versionId), [entries]);
    const getEntry = useCallback((versionId: string) => entries.get(versionId), [entries]);

    const isAnyActionProcessing = useCallback(
        (action: ProcessingAction) => activeEntries.some((entry) => entry.action === action),
        [activeEntries],
    );

    const hasPendingNudge = useCallback((chatId: string) => pendingNudgeChatIds.has(chatId), [pendingNudgeChatIds]);

    const clearPendingNudge = useCallback((chatId: string) => {
        setPendingNudgeChatIds((prev) => {
            const next = new Set(prev);
            next.delete(chatId);
            return next;
        });
    }, []);

    const suppressVersion = useCallback((versionId: string | null) => {
        setSuppressedVersionId(versionId);
    }, []);

    const checkProjectEntry = useCallback((projectId: string): boolean => {
        if (lastEnteredProjectRef.current === projectId) return false;
        lastEnteredProjectRef.current = projectId;
        return true;
    }, []);

    const verifyProcessingEntries = useCallback(
        async (entriesToVerify: ProcessingEntry[]) => {
            if (entriesToVerify.length === 0) return;

            const token = await getToken();
            if (!token) return;

            const projectArtifactApi = createProjectArtifactApi(() => Promise.resolve(token));
            const artifactApi = createArtifactApi(() => Promise.resolve(token));
            const now = Date.now();

            for (const entry of entriesToVerify) {
                if (entry.status !== 'processing') continue;
                if (entry.action !== 'approve' && entry.action !== 'reject') continue;
                if (!entry.artifactName) continue;
                if (now - entry.startedAt > STALE_THRESHOLD_MS) continue;

                try {
                    const artifact = entry.projectId
                        ? await projectArtifactApi.getByKey(entry.projectId, entry.artifactName)
                        : await artifactApi.getByKey(entry.artifactName);
                    const proposedVersion = artifact.proposedVersion;
                    const stillPending =
                        proposedVersion?.id === entry.versionId && proposedVersion.status === 'proposed';

                    if (!stillPending) {
                        dispatchEntries({ type: 'complete', versionId: entry.versionId, now: Date.now() });
                    }
                } catch {
                    // Leave the entry active. A websocket update or visible version status can still reconcile it.
                }
            }
        },
        [getToken],
    );

    useUserEvents(
        useCallback((eventType: string, payload: unknown) => {
            if (
                eventType !== 'artifact_version_update_started' &&
                eventType !== 'artifact_version_update_progress' &&
                eventType !== 'artifact_version_updated'
            ) {
                return;
            }
            if (!payload || typeof payload !== 'object') return;

            const event = payload as WsEventPayload;
            if (!event.versionId || !event.action) return;

            const now = Date.now();
            const incoming = buildEntryFromEvent(event, now);

            if (eventType === 'artifact_version_update_started') {
                dispatchEntries({ type: 'started-event', entry: incoming, now });
                return;
            }

            if (eventType === 'artifact_version_update_progress') {
                dispatchEntries({
                    type: 'progress-event',
                    versionId: event.versionId,
                    progress: event.progress,
                    stage: event.stage,
                    fallbackEntry: incoming,
                    now,
                });
                return;
            }

            const status = event.status === ACTION_SUCCESS_STATUS[event.action] ? 'completed' : 'failed';
            const patch =
                event.restoredVersionNumber != null
                    ? { restoredVersionNumber: event.restoredVersionNumber }
                    : undefined;

            dispatchEntries({
                type: status === 'completed' ? 'complete' : 'fail',
                versionId: event.versionId,
                patch,
                fallbackEntry: incoming,
                now,
            });
        }, []),
    );

    useEffect(() => {
        saveToStorage(entries);
    }, [entries]);

    useEffect(() => {
        savePendingNudges(pendingNudgeChatIds);
    }, [pendingNudgeChatIds]);

    useEffect(() => {
        const terminalEntryIds = new Set<string>();

        for (const entry of allEntries) {
            if (entry.status !== 'completed' && entry.status !== 'failed') continue;

            terminalEntryIds.add(entry.versionId);

            if (
                entry.status === 'completed' &&
                entry.initiatedLocally &&
                entry.chatId &&
                !nudgedCompletionIdsRef.current.has(entry.versionId)
            ) {
                nudgedCompletionIdsRef.current.add(entry.versionId);
                setPendingNudgeChatIds((prev) => {
                    const next = new Set(prev);
                    next.add(entry.chatId!);
                    return next;
                });
            }

            if (!dismissTimersRef.current.has(entry.versionId)) {
                const versionId = entry.versionId;
                const timer = setTimeout(() => {
                    dispatchEntries({ type: 'remove', versionId });
                    dismissTimersRef.current.delete(versionId);
                    nudgedCompletionIdsRef.current.delete(versionId);
                }, AUTO_DISMISS_MS);

                dismissTimersRef.current.set(versionId, timer);
            }
        }

        for (const [versionId, timer] of dismissTimersRef.current) {
            const entry = entries.get(versionId);
            if (entry?.status === 'completed' || entry?.status === 'failed') continue;

            clearTimeout(timer);
            dismissTimersRef.current.delete(versionId);
            nudgedCompletionIdsRef.current.delete(versionId);
        }

        for (const versionId of nudgedCompletionIdsRef.current) {
            if (terminalEntryIds.has(versionId) || entries.has(versionId)) continue;
            nudgedCompletionIdsRef.current.delete(versionId);
        }
    }, [allEntries, entries]);

    useEffect(() => {
        const storedEntries = Array.from(loadFromStorage().values());
        if (storedEntries.length === 0) return;

        dispatchEntries({ type: 'prune-expired', now: Date.now(), thresholdMs: STALE_THRESHOLD_MS });
        void verifyProcessingEntries(storedEntries);
    }, [verifyProcessingEntries]);

    useEffect(
        () => () => {
            for (const timer of dismissTimersRef.current.values()) {
                clearTimeout(timer);
            }
        },
        [],
    );

    const contextValue = useMemo(
        () => ({
            startProcessing,
            failProcessing,
            completeProcessing,
            reconcileVersionStatus,
            isProcessing,
            hasEntry,
            getEntry,
            activeEntries,
            visibleEntries,
            isAnyActionProcessing,
            hasPendingNudge,
            clearPendingNudge,
            suppressVersion,
            checkProjectEntry,
        }),
        [
            startProcessing,
            failProcessing,
            completeProcessing,
            reconcileVersionStatus,
            isProcessing,
            hasEntry,
            getEntry,
            activeEntries,
            visibleEntries,
            isAnyActionProcessing,
            hasPendingNudge,
            clearPendingNudge,
            suppressVersion,
            checkProjectEntry,
        ],
    );

    return <ArtifactProcessingContext.Provider value={contextValue}>{children}</ArtifactProcessingContext.Provider>;
}

export function useArtifactProcessing(): ArtifactProcessingContextValue {
    const context = useContext(ArtifactProcessingContext);
    if (!context) {
        throw new Error('useArtifactProcessing must be used within ArtifactProcessingProvider');
    }
    return context;
}
