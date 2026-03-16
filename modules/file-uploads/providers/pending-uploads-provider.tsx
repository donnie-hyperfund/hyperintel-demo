'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

type PendingUploadsContextValue = {
    storageKey: string;
    pendingArtifactIds: string[];
    addPendingArtifactId: (id: string) => void;
    clearPendingArtifactIds: () => void;
};

type PendingUploadsProviderProps = {
    children: ReactNode;
    storageKey: string;
};

const PendingUploadsContext = createContext<PendingUploadsContextValue | null>(null);

export function PendingUploadsProvider({ children, storageKey }: PendingUploadsProviderProps) {
    const [pendingArtifactIds, setPendingArtifactIds] = useState<string[]>([]);

    const addPendingArtifactId = useCallback((id: string) => {
        setPendingArtifactIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }, []);

    const clearPendingArtifactIds = useCallback(() => {
        setPendingArtifactIds([]);
    }, []);

    return (
        <PendingUploadsContext.Provider
            value={{ storageKey, pendingArtifactIds, addPendingArtifactId, clearPendingArtifactIds }}
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
