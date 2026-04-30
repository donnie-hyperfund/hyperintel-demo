'use client';

import { createContext, type ReactNode, useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import type { CamelCaseDto } from '@/lib/api/client/types';
import type { ArtifactVersionDto } from '@/lib/schema/artifact';
import type { Artifact } from '../../chat/types';
import { getLatestArtifactVersionContent } from '../utils';

/** Update type that allows partial version objects for deep merge */
export type ArtifactUpdate = Omit<Partial<Artifact>, 'proposedVersion' | 'currentVersion'> & {
    proposedVersion?: Partial<CamelCaseDto<ArtifactVersionDto>>;
    currentVersion?: Partial<CamelCaseDto<ArtifactVersionDto>>;
};

type UpdateArtifactOptions = {
    merge?: boolean;
};

export type ArtifactStore = Record<string, Record<string, Artifact>>;
export type VersionKey = 'latest' | number;

function preservePreviewStreamingState(existing: Artifact | undefined, artifact: Artifact): Artifact {
    if (!existing) return artifact;

    // Internal artifact revalidation omits content and frontend-only summary streaming state.
    const preserved: Partial<Artifact> = {};
    const isStillStreaming = artifact.isStreaming ?? existing.isStreaming;
    const hasIncomingSummaryStreaming =
        artifact.summaryStreaming !== undefined ||
        Boolean(artifact.proposedVersion?.summaryInternal) ||
        Boolean(artifact.currentVersion?.summaryInternal);

    if (existing.isStreaming === true && artifact.isStreaming === undefined) {
        preserved.isStreaming = true;
    }

    if (isStillStreaming && artifact.progress === undefined && existing.progress !== undefined) {
        preserved.progress = existing.progress;
    }

    if (
        !hasIncomingSummaryStreaming &&
        artifact.summaryStreaming === undefined &&
        existing.summaryStreaming !== undefined
    ) {
        preserved.summaryStreaming = existing.summaryStreaming;
    }

    if (artifact.isSummaryStreaming === undefined && existing.isSummaryStreaming !== undefined) {
        preserved.isSummaryStreaming = existing.isSummaryStreaming;
    }

    if (Object.keys(preserved).length === 0) return artifact;
    return { ...artifact, ...preserved };
}

export type ArtifactContextValue = {
    getArtifact: (id: string, version?: VersionKey) => Artifact | null;
    getStore: () => ArtifactStore;
    addArtifact: (artifact: Artifact, version?: VersionKey) => void;
    removeArtifact: (id: string, version?: VersionKey) => void;
    updateArtifact: (
        id: string,
        updates: ArtifactUpdate,
        version?: VersionKey,
        options?: UpdateArtifactOptions,
    ) => void;
    subscribe: (callback: () => void) => () => void;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

type ArtifactProviderProps = {
    children: ReactNode;
};

export function ArtifactProvider({ children }: ArtifactProviderProps) {
    const storeRef = useRef<ArtifactStore>({});
    const subscribersRef = useRef(new Set<() => void>());

    const emit = useCallback(() => {
        for (const cb of subscribersRef.current) cb();
    }, []);

    const subscribe = useCallback((callback: () => void) => {
        subscribersRef.current.add(callback);
        return () => {
            subscribersRef.current.delete(callback);
        };
    }, []);

    const getStore = useCallback(() => storeRef.current, []);

    const getArtifact = useCallback((id: string, version: VersionKey = 'latest'): Artifact | null => {
        return storeRef.current[id]?.[String(version)] ?? null;
    }, []);

    const addArtifact = useCallback(
        (artifact: Artifact, version: VersionKey = 'latest') => {
            const versionKey = String(version);
            const prev = storeRef.current;

            const existing = prev[artifact.id]?.[versionKey];
            const nextArtifact = preservePreviewStreamingState(existing, artifact);
            const newContent = getLatestArtifactVersionContent(nextArtifact);
            const existingContent = existing ? getLatestArtifactVersionContent(existing) : '';
            const nextSummary =
                nextArtifact.summaryStreaming ??
                nextArtifact.proposedVersion?.summaryInternal ??
                nextArtifact.currentVersion?.summaryInternal ??
                '';
            const existingSummary =
                existing?.summaryStreaming ??
                existing?.proposedVersion?.summaryInternal ??
                existing?.currentVersion?.summaryInternal ??
                '';
            if (
                existingContent === newContent &&
                existingSummary === nextSummary &&
                existing?.isLoading === nextArtifact.isLoading &&
                existing?.isStreaming === nextArtifact.isStreaming &&
                existing?.isSummaryStreaming === nextArtifact.isSummaryStreaming &&
                existing?.isUpdating === nextArtifact.isUpdating
            ) {
                return;
            }

            storeRef.current = {
                ...prev,
                [artifact.id]: {
                    ...prev[artifact.id],
                    [versionKey]: nextArtifact,
                },
            };
            emit();
        },
        [emit],
    );

    const removeArtifact = useCallback(
        (id: string, version?: VersionKey) => {
            const prev = storeRef.current;
            const existing = prev[id];
            if (!existing) return;

            if (version === undefined) {
                const next = { ...prev };
                delete next[id];
                storeRef.current = next;
                emit();
                return;
            }

            const versionKey = String(version);
            if (!(versionKey in existing)) return;

            const nextVersions = { ...existing };
            delete nextVersions[versionKey];

            if (Object.keys(nextVersions).length === 0) {
                const next = { ...prev };
                delete next[id];
                storeRef.current = next;
            } else {
                storeRef.current = { ...prev, [id]: nextVersions };
            }
            emit();
        },
        [emit],
    );

    const updateArtifact = useCallback(
        (
            id: string,
            updates: ArtifactUpdate,
            version: VersionKey = 'latest',
            options: UpdateArtifactOptions = { merge: true },
        ) => {
            const versionKey = String(version);
            const prev = storeRef.current;
            const existing = prev[id]?.[versionKey];
            if (!existing) return;

            let updated: Artifact;
            if (options.merge) {
                updated = { ...existing, ...updates } as Artifact;
                if (updates.proposedVersion && existing.proposedVersion) {
                    updated.proposedVersion = {
                        ...existing.proposedVersion,
                        ...updates.proposedVersion,
                    } as CamelCaseDto<ArtifactVersionDto>;
                }
                if (updates.currentVersion && existing.currentVersion) {
                    updated.currentVersion = {
                        ...existing.currentVersion,
                        ...updates.currentVersion,
                    } as CamelCaseDto<ArtifactVersionDto>;
                }
            } else {
                updated = preservePreviewStreamingState(existing, updates as Artifact);
            }

            storeRef.current = {
                ...prev,
                [id]: {
                    ...prev[id],
                    [versionKey]: updated,
                },
            };
            emit();
        },
        [emit],
    );

    // Stable context value — created once, never changes reference
    const api = useRef<ArtifactContextValue>({
        getArtifact,
        getStore,
        addArtifact,
        removeArtifact,
        updateArtifact,
        subscribe,
    }).current;

    return <ArtifactContext.Provider value={api}>{children}</ArtifactContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useArtifactContext(): ArtifactContextValue {
    const context = useContext(ArtifactContext);
    if (!context) {
        throw new Error('useArtifacts must be used within an ArtifactProvider');
    }
    return context;
}

/** Subscribe to a single artifact — only re-renders when that specific artifact reference changes. */
export function useArtifact(id: string, version: VersionKey = 'latest'): Artifact | null {
    const { subscribe, getArtifact } = useArtifactContext();
    const getSnapshot = useCallback(() => getArtifact(id, version), [getArtifact, id, version]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Subscribe to the full artifact store — re-renders on any artifact change. */
export function useArtifactStore(): ArtifactStore {
    const { subscribe, getStore } = useArtifactContext();
    return useSyncExternalStore(subscribe, getStore, getStore);
}

/** Stable action references that never cause re-renders. */
export function useArtifactActions() {
    const { addArtifact, removeArtifact, updateArtifact, getArtifact, getStore } = useArtifactContext();
    return { addArtifact, removeArtifact, updateArtifact, getArtifact, getStore };
}
