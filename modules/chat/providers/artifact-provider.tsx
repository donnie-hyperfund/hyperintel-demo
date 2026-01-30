'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { Artifact } from '../types';

export type ArtifactContextValue = {
    artifacts: Record<string, Artifact>;
    addArtifact: (artifact: Artifact) => void;
    updateArtifact: (id: string, updates: Partial<Artifact>) => void;
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
            if (existing?.content === artifact.content && existing?.isLoading === artifact.isLoading && existing?.isStreaming === artifact.isStreaming && existing?.isUpdating === artifact.isUpdating) {
                return prev;
            }
            return {
                ...prev,
                [artifact.id]: artifact,
            };
        });
    }, []);

    const updateArtifact = useCallback((id: string, updates: Partial<Artifact>) => {
        setArtifacts((prev) => {
            const existing = prev[id];
            if (!existing) return prev;

            return {
                ...prev,
                [id]: { ...existing, ...updates },
            };
        });
    }, []);

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
