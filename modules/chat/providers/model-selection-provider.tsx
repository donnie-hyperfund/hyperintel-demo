'use client';

import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { type PresetOption, usePresets } from '@/lib/api/client/hooks/use-presets';
import { DEFAULT_PRESET_ID } from '@/lib/presets';

type ModelSelectionContextValue = {
    selectedModel: string;
    setSelectedModel: (presetId: string) => void;
    /** false if the current preset is not in available presets (e.g. removed/blocked) */
    isModelAvailable: boolean;
    availablePresets: PresetOption[];
    isChangingModel: boolean;
    setIsChangingModel: (v: boolean) => void;
};

const ModelSelectionContext = createContext<ModelSelectionContextValue | null>(null);

export function ModelSelectionProvider({ children }: { children: ReactNode }) {
    const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_PRESET_ID);
    const [isChangingModel, setIsChangingModel] = useState(false);
    const { data: availablePresets, isLoading } = usePresets();
    const isModelAvailable = useMemo(() => {
        if (isLoading && !availablePresets) return true; // Optimistic while loading
        return (availablePresets || []).some((p) => p.id === selectedModel);
    }, [selectedModel, availablePresets, isLoading]);

    return (
        <ModelSelectionContext.Provider
            value={{ selectedModel, setSelectedModel, isModelAvailable, availablePresets: availablePresets ?? [], isChangingModel, setIsChangingModel }}
        >
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
