'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

type PendingUploadsContextValue = {
    pendingArtifactIds: string[];
    addPendingArtifactId: (id: string) => void;
    clearPendingArtifactIds: () => void;
};

const PendingUploadsContext = createContext<PendingUploadsContextValue | null>(null);

export function PendingUploadsProvider({ children }: { children: ReactNode }) {
    const [pendingArtifactIds, setPendingArtifactIds] = useState<string[]>([]);

    const addPendingArtifactId = useCallback((id: string) => {
        setPendingArtifactIds((prev) => [...prev, id]);
    }, []);

    const clearPendingArtifactIds = useCallback(() => {
        setPendingArtifactIds([]);
    }, []);

    return (
        <PendingUploadsContext.Provider value={{ pendingArtifactIds, addPendingArtifactId, clearPendingArtifactIds }}>
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
