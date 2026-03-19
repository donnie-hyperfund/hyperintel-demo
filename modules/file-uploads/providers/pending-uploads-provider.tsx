'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

type PendingUploadsContextValue = {
    pendingArtifactIds: string[];
    addPendingArtifactId: (id: string) => void;
    removePendingArtifactId: (id: string) => void;
    replacePendingArtifactIds: (ids: string[]) => void;
    clearPendingArtifactIds: () => void;
};

const PendingUploadsContext = createContext<PendingUploadsContextValue | null>(null);

export function PendingUploadsProvider({ children }: { children: ReactNode }) {
    const [pendingArtifactIds, setPendingArtifactIds] = useState<string[]>([]);

    const addPendingArtifactId = useCallback((id: string) => {
        setPendingArtifactIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }, []);

    const removePendingArtifactId = useCallback((id: string) => {
        setPendingArtifactIds((prev) => prev.filter((currentId) => currentId !== id));
    }, []);

    const replacePendingArtifactIds = useCallback((ids: string[]) => {
        setPendingArtifactIds([...new Set(ids)]);
    }, []);

    const clearPendingArtifactIds = useCallback(() => {
        setPendingArtifactIds([]);
    }, []);

    return (
        <PendingUploadsContext.Provider
            value={{
                pendingArtifactIds,
                addPendingArtifactId,
                removePendingArtifactId,
                replacePendingArtifactIds,
                clearPendingArtifactIds,
            }}
        >
            {children}
        </PendingUploadsContext.Provider>
    );
}

export function usePendingUploads(): PendingUploadsContextValue {
    const context = useContext(PendingUploadsContext);
    if (!context) {
        throw new Error('usePendingUploads must be used within a PendingUploadsProvider');
    }
    return context;
}
