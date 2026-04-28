'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createProjectArtifactApi } from '@/lib/api/client/fetchers/project-artifacts';
import {
    safeGetJsonItem as sessionGetJson,
    safeRemoveItem as sessionRemove,
    safeSetJsonItem as sessionSetJson,
} from '@/lib/storage/session-storage';
import { ARTIFACT_PROCESSING_KEY, NUDGE_PENDING_KEY } from '@/lib/storage/storage-keys';
import { useUserEvents } from '@/modules/chat/hooks/use-user-events';
import type {
    ProcessingAction,
    ProcessingEntry,
    ProcessingEntryInput,
    ProcessingStage,
    ProcessingStatus,
} from './types';

const AUTO_DISMISS_MS = 3000;
const STALE_THRESHOLD_MS = 60_000;

const ACTION_SUCCESS_STATUS: Record<ProcessingAction, string> = {
    approve: 'approved',
    reject: 'rejected',
    restore: 'proposed',
};

type ArtifactProcessingContextValue = {
    startProcessing: (entry: ProcessingEntryInput) => void;
    failProcessing: (versionId: string) => void;
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

function loadFromStorage(): Map<string, ProcessingEntry> {
    const entries = sessionGetJson<ProcessingEntry[]>(ARTIFACT_PROCESSING_KEY);
    if (!entries) return new Map();
    return new Map(entries.map((entry) => [entry.versionId, entry]));
}

function saveToStorage(entries: Map<string, ProcessingEntry>) {
    const arr = Array.from(entries.values()).filter((entry) => entry.status === 'processing');
    if (arr.length === 0) {
        sessionRemove(ARTIFACT_PROCESSING_KEY);
    } else {
        sessionSetJson(ARTIFACT_PROCESSING_KEY, arr);
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

function clampProgress(progress: number | undefined): number | undefined {
    if (progress == null || Number.isNaN(progress)) return undefined;
    return Math.max(0, Math.min(99, Math.round(progress)));
}

function getProgressPatch(event: WsEventPayload): Partial<ProcessingEntry> {
    const patch: Partial<ProcessingEntry> = {};
    const progress = clampProgress(event.progress);
    if (progress != null) {
        patch.progress = progress;
    }
    if (event.stage) {
        patch.stage = event.stage;
    }
    return patch;
}

function buildEntryFromEvent(event: WsEventPayload): ProcessingEntry | null {
    const progressPatch = getProgressPatch(event);
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
        startedAt: Date.now(),
        ...progressPatch,
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

export function ArtifactProcessingProvider({ children }: { children: ReactNode }) {
    const { getToken } = useAuth();
    const [entries, setEntries] = useState<Map<string, ProcessingEntry>>(() => loadFromStorage());
    const [suppressedVersionId, setSuppressedVersionId] = useState<string | null>(null);
    const [pendingNudgeChatIds, setPendingNudgeChatIds] = useState<Set<string>>(() => loadPendingNudges());
    const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const lastEnteredProjectRef = useRef<string | null>(null);

    const scheduleDismiss = useCallback((versionId: string) => {
        const existing = dismissTimersRef.current.get(versionId);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            setEntries((prev) => {
                const next = new Map(prev);
                next.delete(versionId);
                saveToStorage(next);
                return next;
            });
            dismissTimersRef.current.delete(versionId);
        }, AUTO_DISMISS_MS);

        dismissTimersRef.current.set(versionId, timer);
    }, []);

    const updateEntryStatus = useCallback(
        ({
            versionId,
            status,
            patch,
        }: {
            versionId: string;
            status: ProcessingStatus;
            patch?: Partial<ProcessingEntry>;
        }) => {
            let nudgeChatId: string | undefined;

            setEntries((prev) => {
                const entry = prev.get(versionId);
                if (!entry) return prev;
                const updated = { ...entry, ...patch, status } as ProcessingEntry;
                if (status === 'completed' && entry.initiatedLocally && entry.chatId) {
                    nudgeChatId = entry.chatId;
                }
                const next = new Map(prev);
                next.set(versionId, updated);
                saveToStorage(next);
                return next;
            });

            if (nudgeChatId) {
                const chatId = nudgeChatId;
                setPendingNudgeChatIds((prev) => {
                    const next = new Set(prev);
                    next.add(chatId);
                    savePendingNudges(next);
                    return next;
                });
            }

            if (status === 'completed' || status === 'failed') {
                scheduleDismiss(versionId);
            }
        },
        [scheduleDismiss],
    );

    const startProcessing = useCallback((entry: ProcessingEntryInput) => {
        setEntries((prev) => {
            const next = new Map(prev);
            next.set(entry.versionId, {
                ...entry,
                status: 'processing',
                startedAt: Date.now(),
                initiatedLocally: true,
            } as ProcessingEntry);
            saveToStorage(next);
            return next;
        });
    }, []);

    const failProcessing = useCallback(
        (versionId: string) => {
            updateEntryStatus({ versionId, status: 'failed' });
        },
        [updateEntryStatus],
    );

    useUserEvents(
        useCallback(
            (eventType: string, payload: unknown) => {
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
                const versionId = event.versionId;

                if (eventType === 'artifact_version_update_started') {
                    setEntries((prev) => {
                        const incoming = buildEntryFromEvent(event);
                        if (!incoming) return prev;
                        const next = new Map(prev);
                        const existing = prev.get(versionId);
                        if (existing) {
                            // Local optimistic entry — merge worker-authoritative target context
                            // (chatId/phase) so cross-phase restore enrolls the nudge for the
                            // correct target chat, not the user's current chat.
                            next.set(versionId, {
                                ...existing,
                                chatId: incoming.chatId ?? existing.chatId,
                                projectName: incoming.projectName ?? existing.projectName,
                                phaseName: incoming.phaseName ?? existing.phaseName,
                                phaseIndex: incoming.phaseIndex ?? existing.phaseIndex,
                                progress: Math.max(existing.progress ?? 0, incoming.progress ?? 0) || undefined,
                                stage: incoming.stage ?? existing.stage,
                            } as ProcessingEntry);
                        } else {
                            next.set(versionId, incoming);
                        }
                        saveToStorage(next);
                        return next;
                    });
                    return;
                }

                if (eventType === 'artifact_version_update_progress') {
                    setEntries((prev) => {
                        const existing = prev.get(versionId);
                        const progressPatch = getProgressPatch(event);
                        const incoming = existing ? null : buildEntryFromEvent(event);
                        if (!existing && !incoming) return prev;

                        const next = new Map(prev);
                        if (existing) {
                            next.set(versionId, {
                                ...existing,
                                ...progressPatch,
                                progress:
                                    progressPatch.progress != null
                                        ? Math.max(existing.progress ?? 0, progressPatch.progress)
                                        : existing.progress,
                            } as ProcessingEntry);
                        } else if (incoming) {
                            next.set(versionId, incoming);
                        }
                        saveToStorage(next);
                        return next;
                    });
                    return;
                }

                const status = event.status === ACTION_SUCCESS_STATUS[event.action] ? 'completed' : 'failed';
                const patch = {
                    ...(event.restoredVersionNumber != null
                        ? { restoredVersionNumber: event.restoredVersionNumber }
                        : {}),
                    ...(status === 'completed' ? { progress: 100, stage: 'finalizing' as const } : {}),
                };
                updateEntryStatus({ versionId, status, patch });
            },
            [updateEntryStatus],
        ),
    );

    // Recovery: on mount, verify stale sessionStorage entries against API
    useEffect(() => {
        const stored = loadFromStorage();
        if (stored.size === 0) return;

        const verify = async () => {
            const token = await getToken();
            if (!token) return;

            for (const [versionId, entry] of stored) {
                if (entry.status !== 'processing') continue;

                // Clear entries older than the stale threshold
                if (Date.now() - entry.startedAt > STALE_THRESHOLD_MS) {
                    setEntries((prev) => {
                        const next = new Map(prev);
                        next.delete(versionId);
                        saveToStorage(next);
                        return next;
                    });
                    continue;
                }

                // Verify current status via API — only approve/reject flip an existing proposed version.
                if (entry.action !== 'approve' && entry.action !== 'reject') continue;
                if (!entry.projectId || !entry.artifactName) continue;
                try {
                    const artifact = await createProjectArtifactApi(() => Promise.resolve(token)).getByKey(
                        entry.projectId,
                        entry.artifactName,
                    );
                    const stillPending = artifact.proposedVersion?.status === 'proposed';
                    if (!stillPending) {
                        updateEntryStatus({ versionId, status: 'completed' });
                    }
                } catch {
                    // API error — leave as processing, WS will update eventually
                }
            }
        };

        verify();
    }, [getToken, updateEntryStatus]);

    useEffect(
        () => () => {
            for (const timer of dismissTimersRef.current.values()) {
                clearTimeout(timer);
            }
        },
        [],
    );

    const isProcessing = useCallback(
        (versionId: string) => {
            const entry = entries.get(versionId);
            return entry?.status === 'processing';
        },
        [entries],
    );

    const hasEntry = useCallback((versionId: string) => entries.has(versionId), [entries]);
    const getEntry = useCallback((versionId: string) => entries.get(versionId), [entries]);

    const hasPendingNudge = useCallback((chatId: string) => pendingNudgeChatIds.has(chatId), [pendingNudgeChatIds]);

    const clearPendingNudge = useCallback((chatId: string) => {
        setPendingNudgeChatIds((prev) => {
            const next = new Set(prev);
            next.delete(chatId);
            savePendingNudges(next);
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

    const allEntries = useMemo(() => Array.from(entries.values()), [entries]);
    const activeEntries = useMemo(() => allEntries.filter((entry) => entry.status === 'processing'), [allEntries]);
    const visibleEntries = useMemo(
        () => allEntries.filter((entry) => entry.versionId !== suppressedVersionId),
        [allEntries, suppressedVersionId],
    );

    const isAnyActionProcessing = useCallback(
        (action: ProcessingAction) => activeEntries.some((entry) => entry.action === action),
        [activeEntries],
    );

    const contextValue = useMemo(
        () => ({
            startProcessing,
            failProcessing,
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
