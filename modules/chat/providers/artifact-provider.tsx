'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { ArtifactVersionDto } from '@/lib/schema/artifact';
import type { Artifact } from '../types';
import { getArtifactContent } from '../types';

/** Update type that allows partial version objects for deep merge */
export type ArtifactUpdate = Omit<Partial<Artifact>, 'proposed_version' | 'current_version'> & {
    proposed_version?: Partial<ArtifactVersionDto>;
    current_version?: Partial<ArtifactVersionDto>;
};

type UpdateArtifactOptions = {
    merge?: boolean;
};

export type ArtifactContextValue = {
    artifacts: Record<string, Artifact>;
    addArtifact: (artifact: Artifact) => void;
    updateArtifact: (id: string, updates: ArtifactUpdate, options?: UpdateArtifactOptions) => void;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

type ArtifactProviderProps = {
    children: ReactNode;
};

export function ArtifactProvider({ children }: ArtifactProviderProps) {
    const [artifacts, setArtifacts] = useState<Record<string, Artifact>>({});

    const addArtifact = useCallback((artifact: Artifact) => {
        setArtifacts((prev) => {
            const existing = prev[artifact.id];
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
            console.log('added artifact', {
                ...prev,
                [artifact.id]: artifact,
            });

            return {
                ...prev,
                [artifact.id]: artifact,
            };
        });
    }, []);

    const updateArtifact = useCallback(
        (id: string, updates: ArtifactUpdate, options: UpdateArtifactOptions = { merge: true }) => {
            setArtifacts((prev) => {
                const existing = prev[id];
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

                    console.log(
                        'updated artifact',
                        {
                            ...prev,
                            [id]: merged,
                        },
                        updates,
                        !!updates.proposed_version,
                        !!existing.proposed_version,
                    );

                    return { ...prev, [id]: merged };
                }

                // TODO: Make it typesafe
                return { ...prev, [id]: updates as Artifact };
            });
        },
        [],
    );

    return (
        <ArtifactContext.Provider
            value={{
                artifacts,
                addArtifact,
                updateArtifact,
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
