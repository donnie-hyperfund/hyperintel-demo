'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createProjectArtifactApi } from '@/lib/api/client/fetchers/project-artifacts';
import {
    safeGetJsonItem as sessionGetJson,
    safeRemoveItem as sessionRemove,
    safeSetJsonItem as sessionSetJson,
} from '@/lib/storage/session-storage';
import { ARTIFACT_PROCESSING_KEY, NUDGE_PENDING_KEY } from '@/lib/storage/storage-keys';
import { useUserEvents } from '@/modules/chat/hooks/use-user-events';
import { type ProcessingAction, type ProcessingEntry, type ProcessingStatus } from './types';

const AUTO_DISMISS_MS = 3000;
const STALE_THRESHOLD_MS = 60_000;

type ArtifactProcessingContextValue = {
    startProcessing: (entry: Omit<ProcessingEntry, 'status' | 'startedAt' | 'initiatedLocally'>) => void;
    isProcessing: (versionId: string) => boolean;
    hasEntry: (versionId: string) => boolean;
    activeEntries: ProcessingEntry[];
    visibleEntries: ProcessingEntry[];
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

type WsEventPayload = {
    artifactId?: string;
    artifactName?: string;
    versionId?: string;
    version?: number;
    action?: string;
    previousStatus?: string;
    status?: string;
    nextStatus?: string;
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
        (versionId: string, status: ProcessingStatus) => {
            let nudgeChatId: string | undefined;

            setEntries((prev) => {
                const entry = prev.get(versionId);
                if (!entry) return prev;
                const updated = { ...entry, status };
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

    const startProcessing = useCallback((entry: Omit<ProcessingEntry, 'status' | 'startedAt' | 'initiatedLocally'>) => {
        setEntries((prev) => {
            const next = new Map(prev);
            next.set(entry.versionId, {
                ...entry,
                status: 'processing',
                startedAt: Date.now(),
                initiatedLocally: true,
            });
            saveToStorage(next);
            return next;
        });
    }, []);

    useUserEvents(
        useCallback(
            (eventType: string, payload: unknown) => {
                if (eventType !== 'artifact_version_update_started' && eventType !== 'artifact_version_updated') return;
                if (!payload || typeof payload !== 'object') return;

                const event = payload as WsEventPayload;
                if (!event.versionId || !event.action) return;

                if (eventType === 'artifact_version_update_started') {
                    setEntries((prev) => {
                        if (prev.has(event.versionId!)) return prev;
                        const next = new Map(prev);
                        next.set(event.versionId!, {
                            versionId: event.versionId!,
                            artifactId: event.artifactId ?? '',
                            artifactName: event.artifactName ?? '',
                            artifactVersion: event.version ?? 0,
                            action: event.action as ProcessingAction,
                            status: 'processing',
                            projectId: event.projectId,
                            projectName: event.projectName,
                            phaseName: event.phaseName ?? undefined,
                            phaseIndex: event.phaseIndex,
                            chatId: event.chatId,
                            startedAt: Date.now(),
                            initiatedLocally: false,
                        });
                        saveToStorage(next);
                        return next;
                    });
                    return;
                }

                const finalStatus = event.status === 'approved' || event.status === 'rejected' ? 'completed' : 'failed';
                updateEntryStatus(event.versionId!, finalStatus);
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

                // Verify current status via API
                if (!entry.projectId || !entry.artifactName) continue;
                try {
                    const artifact = await createProjectArtifactApi(() => Promise.resolve(token)).getByKey(
                        entry.projectId,
                        entry.artifactName,
                    );
                    const stillPending = artifact.proposedVersion?.status === 'proposed';
                    if (!stillPending) {
                        updateEntryStatus(versionId, 'completed');
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

    const allEntries = Array.from(entries.values());
    const activeEntries = allEntries.filter((entry) => entry.status === 'processing');
    const visibleEntries = allEntries.filter((entry) => entry.versionId !== suppressedVersionId);

    return (
        <ArtifactProcessingContext.Provider
            value={{
                startProcessing,
                isProcessing,
                hasEntry,
                activeEntries,
                visibleEntries,
                hasPendingNudge,
                clearPendingNudge,
                suppressVersion,
                checkProjectEntry,
            }}
        >
            {children}
        </ArtifactProcessingContext.Provider>
    );
}

export function useArtifactProcessing(): ArtifactProcessingContextValue {
    const context = useContext(ArtifactProcessingContext);
    if (!context) {
        throw new Error('useArtifactProcessing must be used within ArtifactProcessingProvider');
    }
    return context;
}
