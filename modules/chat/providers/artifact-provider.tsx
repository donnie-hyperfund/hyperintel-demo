'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { Artifact } from '../types';

export type ArtifactContextValue = {
    artifacts: Record<string, Artifact>;
    currentArtifactId: string | null;
    streamingArtifactId: string | null;
    isVisible: boolean;
    isLoading: boolean;
    loadingTitle: string | null;
    addArtifact: (artifact: Artifact, isStreaming?: boolean) => void;
    updateArtifact: (id: string, updates: Partial<Artifact>) => void;
    setCurrentArtifact: (id: string | null) => void;
    setLoading: (loading: boolean, title?: string) => void;
    setStreamingComplete: (id: string) => void;
    togglePanel: (visible?: boolean) => void;

    // Computed values
    currentArtifact: Artifact | null;
    isCurrentArtifactStreaming: boolean;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

type ArtifactProviderProps = {
    children: ReactNode;
};

export function ArtifactProvider({ children }: ArtifactProviderProps) {
    const [artifacts, setArtifacts] = useState<Record<string, Artifact>>({});
    const [currentArtifactId, setCurrentArtifactId] = useState<string | null>(null);
    const [streamingArtifactId, setStreamingArtifactId] = useState<string | null>(null);
    const [isVisible, setIsVisible] = useState(false);
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

    const setCurrentArtifact = useCallback((id: string | null) => {
        setCurrentArtifactId(id);
        if (id) {
            setIsVisible(true);
            setIsLoading(false);
            setLoadingTitle(null);
        }
    }, []);

    const setLoading = useCallback((loading: boolean, title?: string) => {
        setIsLoading(loading);
        setLoadingTitle(title ?? null);
        if (loading) {
            setIsVisible(true);
            setCurrentArtifactId(null);
        }
    }, []);

    const togglePanel = useCallback((visible?: boolean) => {
        setIsVisible((prev) => (visible !== undefined ? visible : !prev));
        if (visible === false) {
            setCurrentArtifactId(null);
            setIsLoading(false);
            setLoadingTitle(null);
        }
    }, []);

    return (
        <ArtifactContext.Provider
            value={{
                artifacts,
                currentArtifactId,
                streamingArtifactId,
                isVisible,
                isLoading,
                loadingTitle,
                addArtifact,
                updateArtifact,
                setCurrentArtifact,
                setLoading,
                setStreamingComplete,
                togglePanel,

                // Computed values
                currentArtifact: currentArtifactId ? artifacts[currentArtifactId] : null,
                isCurrentArtifactStreaming: currentArtifactId !== null && currentArtifactId === streamingArtifactId,
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
