'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { Artifact } from '../types';

export type ArtifactContextValue = {
    artifacts: Record<string, Artifact>;
    currentArtifactId: string | null;
    isVisible: boolean;
    addArtifact: (artifact: Artifact) => void;
    updateArtifact: (id: string, updates: Partial<Artifact>) => void;
    setCurrentArtifact: (id: string | null) => void;
    togglePanel: (visible?: boolean) => void;

    // Computed values
    currentArtifact: Artifact | null;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

type ArtifactProviderProps = {
    children: ReactNode;
};

export function ArtifactProvider({ children }: ArtifactProviderProps) {
    const [artifacts, setArtifacts] = useState<Record<string, Artifact>>({});
    const [currentArtifactId, setCurrentArtifactId] = useState<string | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    const addArtifact = useCallback((artifact: Artifact) => {
        setArtifacts((prev) => {
            if (prev[artifact.id]?.content === artifact.content) {
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

    const setCurrentArtifact = useCallback((id: string | null) => {
        setCurrentArtifactId(id);
        if (id) {
            setIsVisible(true);
        }
    }, []);

    const togglePanel = useCallback((visible?: boolean) => {
        setIsVisible((prev) => (visible !== undefined ? visible : !prev));
        if (visible === false) {
            setCurrentArtifactId(null);
        }
    }, []);

    return (
        <ArtifactContext.Provider
            value={{
                artifacts,
                currentArtifactId,
                isVisible,
                addArtifact,
                updateArtifact,
                setCurrentArtifact,
                togglePanel,

                // Computed values
                currentArtifact: currentArtifactId ? artifacts[currentArtifactId] : null,
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
