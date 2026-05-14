'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
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
export type ArtifactScope = string;

export const USER_ARTIFACT_SCOPE = 'user';

const EMPTY_ARTIFACT_STORE: ArtifactStore = {};

export function getProjectArtifactScope(projectId: string): ArtifactScope {
    return `project:${projectId}`;
}

export function getArtifactScopeForProject(projectId?: string | null): ArtifactScope {
    return projectId ? getProjectArtifactScope(projectId) : USER_ARTIFACT_SCOPE;
}

const ArtifactScopeContext = createContext<ArtifactScope>(USER_ARTIFACT_SCOPE);

export function ArtifactScopeProvider({ scope, children }: { scope: ArtifactScope; children: ReactNode }) {
    return <ArtifactScopeContext.Provider value={scope}>{children}</ArtifactScopeContext.Provider>;
}

export function useArtifactScope(): ArtifactScope {
    return useContext(ArtifactScopeContext);
}

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
    getArtifact: (scope: ArtifactScope, id: string, version?: VersionKey) => Artifact | null;
    getStore: (scope: ArtifactScope) => ArtifactStore;
    addArtifact: (scope: ArtifactScope, artifact: Artifact, version?: VersionKey) => void;
    removeArtifact: (scope: ArtifactScope, id: string, version?: VersionKey) => void;
    updateArtifact: (
        scope: ArtifactScope,
        id: string,
        updates: ArtifactUpdate,
        version?: VersionKey,
        options?: UpdateArtifactOptions,
    ) => void;
    clearStaleStreamingForChat: (
        scope: ArtifactScope,
        chatId: string,
    ) => Array<{ artifactId: string; version: number }>;
    subscribe: (callback: () => void) => () => void;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

type ArtifactProviderProps = {
    children: ReactNode;
};

export function ArtifactProvider({ children }: ArtifactProviderProps) {
    const storeRef = useRef<Record<ArtifactScope, ArtifactStore>>({});
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

    const getStore = useCallback((scope: ArtifactScope) => storeRef.current[scope] ?? EMPTY_ARTIFACT_STORE, []);

    const getArtifact = useCallback(
        (scope: ArtifactScope, id: string, version: VersionKey = 'latest'): Artifact | null => {
            return storeRef.current[scope]?.[id]?.[String(version)] ?? null;
        },
        [],
    );

    const addArtifact = useCallback(
        (scope: ArtifactScope, artifact: Artifact, version: VersionKey = 'latest') => {
            const versionKey = String(version);
            const prev = storeRef.current;
            const scopedStore = prev[scope] ?? EMPTY_ARTIFACT_STORE;

            const existing = scopedStore[artifact.id]?.[versionKey];
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
                [scope]: {
                    ...scopedStore,
                    [artifact.id]: {
                        ...scopedStore[artifact.id],
                        [versionKey]: nextArtifact,
                    },
                },
            };
            emit();
        },
        [emit],
    );

    const removeArtifact = useCallback(
        (scope: ArtifactScope, id: string, version?: VersionKey) => {
            const prev = storeRef.current;
            const scopedStore = prev[scope];
            const existing = scopedStore?.[id];
            if (!existing) return;

            if (version === undefined) {
                const nextScopedStore = { ...scopedStore };
                delete nextScopedStore[id];
                storeRef.current = {
                    ...prev,
                    [scope]: nextScopedStore,
                };
                emit();
                return;
            }

            const versionKey = String(version);
            if (!(versionKey in existing)) return;

            const nextVersions = { ...existing };
            delete nextVersions[versionKey];

            if (Object.keys(nextVersions).length === 0) {
                const nextScopedStore = { ...scopedStore };
                delete nextScopedStore[id];
                storeRef.current = {
                    ...prev,
                    [scope]: nextScopedStore,
                };
            } else {
                storeRef.current = {
                    ...prev,
                    [scope]: {
                        ...scopedStore,
                        [id]: nextVersions,
                    },
                };
            }
            emit();
        },
        [emit],
    );

    const updateArtifact = useCallback(
        (
            scope: ArtifactScope,
            id: string,
            updates: ArtifactUpdate,
            version: VersionKey = 'latest',
            options: UpdateArtifactOptions = { merge: true },
        ) => {
            const versionKey = String(version);
            const prev = storeRef.current;
            const scopedStore = prev[scope];
            const existing = scopedStore?.[id]?.[versionKey];
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
                [scope]: {
                    ...scopedStore,
                    [id]: {
                        ...scopedStore[id],
                        [versionKey]: updated,
                    },
                },
            };
            emit();
        },
        [emit],
    );

    const clearStaleStreamingForChat = useCallback(
        (scope: ArtifactScope, chatId: string) => {
            const cleared: Array<{ artifactId: string; version: number }> = [];
            if (!chatId) return cleared;
            const prev = storeRef.current;
            const scopedStore = prev[scope];
            if (!scopedStore) return cleared;
            const next: ArtifactStore = {};

            for (const [artifactId, versions] of Object.entries(scopedStore)) {
                const nextVersions: Record<string, Artifact> = {};
                for (const [versionKey, artifact] of Object.entries(versions)) {
                    if (
                        artifact.sourceChatId === chatId &&
                        (artifact.isStreaming ||
                            artifact.isUpdating ||
                            artifact.isSummaryStreaming ||
                            artifact.summaryStreaming !== undefined)
                    ) {
                        nextVersions[versionKey] = {
                            ...artifact,
                            isStreaming: false,
                            isUpdating: false,
                            isSummaryStreaming: false,
                            summaryStreaming: undefined,
                        };
                        const versionNum = artifact.proposedVersion?.version ?? artifact.version;
                        if (typeof versionNum === 'number') {
                            cleared.push({ artifactId, version: versionNum });
                        }
                    } else {
                        nextVersions[versionKey] = artifact;
                    }
                }
                next[artifactId] = nextVersions;
            }

            if (cleared.length > 0) {
                storeRef.current = {
                    ...prev,
                    [scope]: next,
                };
                emit();
            }
            return cleared;
        },
        [emit],
    );

    const api = useRef<ArtifactContextValue>({
        getArtifact,
        getStore,
        addArtifact,
        removeArtifact,
        updateArtifact,
        clearStaleStreamingForChat,
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
export function useArtifact(
    id: string,
    version: VersionKey = 'latest',
    scopeOverride?: ArtifactScope,
): Artifact | null {
    const { subscribe, getArtifact } = useArtifactContext();
    const scope = useArtifactScope();
    const effectiveScope = scopeOverride ?? scope;
    const getSnapshot = useCallback(
        () => getArtifact(effectiveScope, id, version),
        [getArtifact, effectiveScope, id, version],
    );
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Subscribe to the full artifact store — re-renders on any artifact change. */
export function useArtifactStore(scopeOverride?: ArtifactScope): ArtifactStore {
    const { subscribe, getStore } = useArtifactContext();
    const scope = useArtifactScope();
    const effectiveScope = scopeOverride ?? scope;
    const getSnapshot = useCallback(() => getStore(effectiveScope), [getStore, effectiveScope]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useArtifactStoreController(): ArtifactContextValue {
    return useArtifactContext();
}

export function useArtifactActionsForScope(scope: ArtifactScope) {
    const { addArtifact, removeArtifact, updateArtifact, getArtifact, getStore, clearStaleStreamingForChat } =
        useArtifactContext();
    return useMemo(
        () => ({
            addArtifact: (artifact: Artifact, version?: VersionKey) => addArtifact(scope, artifact, version),
            removeArtifact: (id: string, version?: VersionKey) => removeArtifact(scope, id, version),
            updateArtifact: (
                id: string,
                updates: ArtifactUpdate,
                version?: VersionKey,
                options?: UpdateArtifactOptions,
            ) => updateArtifact(scope, id, updates, version, options),
            getArtifact: (id: string, version?: VersionKey) => getArtifact(scope, id, version),
            getStore: () => getStore(scope),
            clearStaleStreamingForChat: (chatId: string) => clearStaleStreamingForChat(scope, chatId),
        }),
        [addArtifact, removeArtifact, updateArtifact, getArtifact, getStore, clearStaleStreamingForChat, scope],
    );
}

export function useArtifactActions() {
    const scope = useArtifactScope();
    return useArtifactActionsForScope(scope);
}
