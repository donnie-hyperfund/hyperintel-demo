'use client';

import { ANTHROPIC_MODELS } from '@common/ai/types';
import { createContext, type ReactNode, useContext, useState } from 'react';

type ModelSelectionContextValue = {
    selectedModel: ANTHROPIC_MODELS;
    setSelectedModel: (model: ANTHROPIC_MODELS) => void;
};

const ModelSelectionContext = createContext<ModelSelectionContextValue | null>(null);

export function ModelSelectionProvider({ children }: { children: ReactNode }) {
    const [selectedModel, setSelectedModel] = useState<ANTHROPIC_MODELS>(ANTHROPIC_MODELS.SONNET);

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
