'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePresets } from '@/lib/api/client/hooks/use-presets';
import { IS_DEV } from '@/lib/config';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/storage/local-storage';
import { getModelStorageKey } from '@/lib/storage/storage-keys';

type ModelSelectionContextValue = {
    selectedModel: string;
    setSelectedModel: (presetId: string) => void;
    /** Persist selection to localStorage (pre-chat bridge). */
    persistSelection: (presetId: string) => void;
    /** Clear the localStorage bridge (called when DB becomes source of truth). */
    clearPersistedSelection: () => void;
    /** false if the current preset is not in available presets (e.g. removed/blocked) */
    isModelAvailable: boolean;
    availablePresets: { id: string; label: string; description?: string }[];
    isChangingModel: boolean;
    setIsChangingModel: (v: boolean) => void;
};

const ModelSelectionContext = createContext<ModelSelectionContextValue | null>(null);

type ModelSelectionProviderProps = {
    children: ReactNode;
    projectId?: string;
};

export function ModelSelectionProvider({ children, projectId }: ModelSelectionProviderProps) {
    const storageKey = projectId ? getModelStorageKey(projectId) : null;
    const storageMarker = storageKey ?? '__no-project-model-storage__';

    const [selectedModel, setSelectedModel] = useState<string | null>(null);
    const [hydratedStorageMarker, setHydratedStorageMarker] = useState<string | null>(null);
    const [isChangingModel, setIsChangingModel] = useState(false);
    const { data, isLoading } = usePresets();

    const availablePresets = data?.presets ?? [];
    const defaultPresetId = data?.defaultPresetId ?? 'sonnet';

    // Hydrate project-scoped selection from localStorage after mount to keep SSR stable.
    useEffect(() => {
        setSelectedModel(storageKey ? safeGetItem(storageKey) : null);
        setHydratedStorageMarker(storageMarker);
    }, [storageKey, storageMarker]);

    // Initialize selected model from API default once loaded
    useEffect(() => {
        if (hydratedStorageMarker !== storageMarker) return;
        if (selectedModel === null && defaultPresetId) {
            setSelectedModel(defaultPresetId);
        }
    }, [defaultPresetId, hydratedStorageMarker, selectedModel, storageMarker]);

    // On prod (switcher hidden), auto-switch to default if selected preset is unavailable
    useEffect(() => {
        if (IS_DEV) return; // Dev has the switcher — let the user handle it
        if (isLoading || !availablePresets.length || selectedModel === null) return;
        if (!availablePresets.some((p) => p.id === selectedModel)) {
            setSelectedModel(defaultPresetId);
        }
    }, [selectedModel, availablePresets, isLoading, defaultPresetId]);

    const persistSelection = useCallback(
        (presetId: string) => {
            setSelectedModel(presetId);
            if (storageKey) safeSetItem(storageKey, presetId);
        },
        [storageKey],
    );

    const clearPersistedSelection = useCallback(() => {
        if (storageKey) safeRemoveItem(storageKey);
    }, [storageKey]);

    const isModelAvailable = useMemo(() => {
        if (isLoading || !availablePresets.length) return true; // Optimistic while loading
        return availablePresets.some((p) => p.id === (selectedModel ?? defaultPresetId));
    }, [selectedModel, availablePresets, isLoading, defaultPresetId]);

    return (
        <ModelSelectionContext.Provider
            value={{
                selectedModel: selectedModel ?? defaultPresetId,
                setSelectedModel,
                persistSelection,
                clearPersistedSelection,
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
