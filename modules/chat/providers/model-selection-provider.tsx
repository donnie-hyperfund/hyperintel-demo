'use client';

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { usePresets } from '@/lib/api/client/hooks/use-presets';

type ModelSelectionContextValue = {
    selectedModel: string;
    setSelectedModel: (presetId: string) => void;
    /** false if the current preset is not in available presets (e.g. removed/blocked) */
    isModelAvailable: boolean;
    availablePresets: { id: string; label: string; description?: string }[];
    isChangingModel: boolean;
    setIsChangingModel: (v: boolean) => void;
};

const ModelSelectionContext = createContext<ModelSelectionContextValue | null>(null);

export function ModelSelectionProvider({ children }: { children: ReactNode }) {
    const [selectedModel, setSelectedModel] = useState<string | null>(null);
    const [isChangingModel, setIsChangingModel] = useState(false);
    const { data, isLoading } = usePresets();

    const availablePresets = data?.presets ?? [];
    const defaultPresetId = data?.defaultPresetId ?? 'sonnet';

    // Initialize selected model from API default once loaded
    useEffect(() => {
        if (selectedModel === null && defaultPresetId) {
            setSelectedModel(defaultPresetId);
        }
    }, [selectedModel, defaultPresetId]);

    // Auto-switch to default if selected preset becomes unavailable
    useEffect(() => {
        if (isLoading || !availablePresets.length || selectedModel === null) return;
        if (!availablePresets.some((p) => p.id === selectedModel)) {
            setSelectedModel(defaultPresetId);
        }
    }, [selectedModel, availablePresets, isLoading, defaultPresetId]);

    const isModelAvailable = useMemo(() => {
        if (isLoading || !availablePresets.length) return true; // Optimistic while loading
        return availablePresets.some((p) => p.id === (selectedModel ?? defaultPresetId));
    }, [selectedModel, availablePresets, isLoading, defaultPresetId]);

    return (
        <ModelSelectionContext.Provider
            value={{
                selectedModel: selectedModel ?? defaultPresetId,
                setSelectedModel,
                isModelAvailable,
                availablePresets,
                isChangingModel,
                setIsChangingModel,
            }}
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
