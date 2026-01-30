'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { Artifact } from '../types';

export type ArtifactContextValue = {
    artifacts: Record<string, Artifact>;
    streamingArtifactId: string | null;
    isLoading: boolean;
    loadingTitle: string | null;
    addArtifact: (artifact: Artifact, isStreaming?: boolean) => void;
    updateArtifact: (id: string, updates: Partial<Artifact>) => void;
    setLoading: (loading: boolean, title?: string) => void;
    setStreamingComplete: (id: string) => void;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

type ArtifactProviderProps = {
    children: ReactNode;
};

export function ArtifactProvider({ children }: ArtifactProviderProps) {
    const [artifacts, setArtifacts] = useState<Record<string, Artifact>>({});
    const [streamingArtifactId, setStreamingArtifactId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingTitle, setLoadingTitle] = useState<string | null>(null);

    const addArtifact = useCallback((artifact: Artifact, isStreaming = false) => {
        setArtifacts((prev) => {
            if (prev[artifact.id]?.content === artifact.content) {
                return prev;
            }
            return {
                ...prev,
                [artifact.id]: artifact,
            };
        });
        if (isStreaming) {
            setStreamingArtifactId(artifact.id);
        }
    }, []);

    const setStreamingComplete = useCallback((id: string) => {
        setStreamingArtifactId((prev) => (prev === id ? null : prev));
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

    const setLoading = useCallback((loading: boolean, title?: string) => {
        setIsLoading(loading);
        setLoadingTitle(title ?? null);
    }, []);

    return (
        <ArtifactContext.Provider
            value={{
                artifacts,
                streamingArtifactId,
                isLoading,
                loadingTitle,
                addArtifact,
                updateArtifact,
                setLoading,
                setStreamingComplete,
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
