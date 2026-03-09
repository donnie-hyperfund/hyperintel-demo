'use client';

import { createContext, type ReactNode, useContext, useState } from 'react';
import { DEFAULT_PRESET_ID } from '@/lib/presets';

type ModelSelectionContextValue = {
    selectedModel: string;
    setSelectedModel: (presetId: string) => void;
};

const ModelSelectionContext = createContext<ModelSelectionContextValue | null>(null);

export function ModelSelectionProvider({ children }: { children: ReactNode }) {
    const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_PRESET_ID);

    return (
        <ModelSelectionContext.Provider value={{ selectedModel, setSelectedModel }}>
            {children}
        </ModelSelectionContext.Provider>
    );
}

export function useModelSelection(): ModelSelectionContextValue {
    const context = useContext(ModelSelectionContext);
    if (!context) {
        throw new Error('useModelSelection must be used within a ModelSelectionProvider');
    }
    return context;
}
