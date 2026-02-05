'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { ArtifactVersionDto } from '@/lib/schema/artifact';
import type { Artifact } from '../../types';
import { getArtifactContent } from './utils';

/** Update type that allows partial version objects for deep merge */
export type ArtifactUpdate = Omit<Partial<Artifact>, 'proposed_version' | 'current_version'> & {
    proposed_version?: Partial<ArtifactVersionDto>;
    current_version?: Partial<ArtifactVersionDto>;
};

type UpdateArtifactOptions = {
    merge?: boolean;
};

export type ArtifactStore = Record<string, Record<string, Artifact>>;
export type VersionKey = 'latest' | number;

export type ArtifactContextValue = {
    artifacts: ArtifactStore;
    getArtifact: (id: string, version?: VersionKey) => Artifact | null;
    addArtifact: (artifact: Artifact, version?: VersionKey) => void;
    updateArtifact: (
        id: string,
        updates: ArtifactUpdate,
        version?: VersionKey,
        options?: UpdateArtifactOptions,
    ) => void;
    /** Returns true if any artifact has a proposed version with status 'proposed' */
    hasPendingArtifacts: () => boolean;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

type ArtifactProviderProps = {
    children: ReactNode;
};

export function ArtifactProvider({ children }: ArtifactProviderProps) {
    const [artifacts, setArtifacts] = useState<ArtifactStore>({});

    const getArtifact = useCallback(
        (id: string, version: VersionKey = 'latest'): Artifact | null => {
            return artifacts[id]?.[String(version)] ?? null;
        },
        [artifacts],
    );

    const addArtifact = useCallback((artifact: Artifact, version: VersionKey = 'latest') => {
        const versionKey = String(version);

        setArtifacts((prev) => {
            const existing = prev[artifact.id]?.[versionKey];
            const newContent = getArtifactContent(artifact);
            const existingContent = existing ? getArtifactContent(existing) : '';
            if (
                existingContent === newContent &&
                existing?.isLoading === artifact.isLoading &&
                existing?.isStreaming === artifact.isStreaming &&
                existing?.isUpdating === artifact.isUpdating
            ) {
                return prev;
            }

            return {
                ...prev,
                [artifact.id]: {
                    ...prev[artifact.id],
                    [versionKey]: artifact,
                },
            };
        });
    }, []);

    const hasPendingArtifacts = useCallback(() => {
        return Object.values(artifacts).some((versions) =>
            Object.values(versions).some((artifact) => artifact.proposed_version?.status === 'proposed'),
        );
    }, [artifacts]);

    const updateArtifact = useCallback(
        (
            id: string,
            updates: ArtifactUpdate,
            version: VersionKey = 'latest',
            options: UpdateArtifactOptions = { merge: true },
        ) => {
            const versionKey = String(version);
            setArtifacts((prev) => {
                const existing = prev[id]?.[versionKey];
                if (!existing) return prev;

                if (options.merge) {
                    const merged: Artifact = { ...existing, ...updates } as Artifact;
                    // Deep merge version objects so callers can pass partial version updates
                    if (updates.proposed_version && existing.proposed_version) {
                        merged.proposed_version = {
                            ...existing.proposed_version,
                            ...updates.proposed_version,
                        } as ArtifactVersionDto;
                    }
                    if (updates.current_version && existing.current_version) {
                        merged.current_version = {
                            ...existing.current_version,
                            ...updates.current_version,
                        } as ArtifactVersionDto;
                    }

                    return {
                        ...prev,
                        [id]: {
                            ...prev[id],
                            [versionKey]: merged,
                        },
                    };
                }

                return {
                    ...prev,
                    [id]: {
                        ...prev[id],
                        [versionKey]: updates as Artifact,
                    },
                };
            });
        },
        [],
    );

    return (
        <ArtifactContext.Provider
            value={{
                artifacts,
                getArtifact,
                addArtifact,
                updateArtifact,
                hasPendingArtifacts,
            }}
        >
            {children}
        </ArtifactContext.Provider>
    );
}

export function useArtifactContext(): ArtifactContextValue {
    const context = useContext(ArtifactContext);
    if (!context) {
        throw new Error('useArtifacts must be used within an ArtifactProvider');
    }
    return context;
}
