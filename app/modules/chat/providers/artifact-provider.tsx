'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { Artifact, ArtifactContextValue } from '@/app/modules/chat/types';

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
            // Skip if artifact already exists with same content
            if (prev[artifact.id]?.content === artifact.content) {
                return prev;
            }
            return {
                ...prev,
                [artifact.id]: artifact,
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

    const value: ArtifactContextValue = {
        artifacts,
        currentArtifactId,
        isVisible,
        addArtifact,
        setCurrentArtifact,
        togglePanel,
    };

    return <ArtifactContext.Provider value={value}>{children}</ArtifactContext.Provider>;
}

export function useArtifacts() {
    const context = useContext(ArtifactContext);
    if (!context) {
        throw new Error('useArtifacts must be used within an ArtifactProvider');
    }
    return context;
}

export function useCurrentArtifact() {
    const { artifacts, currentArtifactId } = useArtifacts();
    return currentArtifactId ? (artifacts[currentArtifactId] ?? null) : null;
}
