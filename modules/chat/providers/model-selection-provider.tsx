'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSWRConfig } from 'swr';
import { createProjectApi, projectKeys } from '@/lib/api/client/fetchers/projects';
import { usePresets } from '@/lib/api/client/hooks/use-presets';
import { useFetchProject } from '@/lib/api/client/hooks/use-projects';
import { IS_DEV } from '@/lib/config';

type ModelSelectionContextValue = {
    selectedModel: string;
    setSelectedModel: (presetId: string) => void;
    /** Persist selection to project's preferred_model in DB and update SWR cache. */
    persistSelection: (presetId: string) => void;
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
    const { getToken } = useAuth();
    const { mutate: globalMutate } = useSWRConfig();
    const { data: project } = useFetchProject(projectId);
    const { data, isLoading } = usePresets();

    const availablePresets = data?.presets ?? [];
    const defaultPresetId = data?.defaultPresetId ?? 'sonnet';

    const [selectedModel, setSelectedModel] = useState<string | null>(null);
    const [isChangingModel, setIsChangingModel] = useState(false);

    // Initialize selected model from project preference or API default
    useEffect(() => {
        if (selectedModel !== null) return;
        if (projectId && !project) return; // wait for project data (instant from SWR cache)
        setSelectedModel(project?.preferredModel ?? defaultPresetId);
    }, [selectedModel, project, projectId, defaultPresetId]);

    // On prod (switcher hidden), auto-switch to default if selected preset is unavailable
    useEffect(() => {
        if (IS_DEV) return; // Dev has the switcher — let the user handle it
        if (isLoading || !availablePresets.length || selectedModel === null) return;
        if (!availablePresets.some((preset) => preset.id === selectedModel)) {
            setSelectedModel(defaultPresetId);
        }
    }, [selectedModel, availablePresets, isLoading, defaultPresetId]);

    const persistSelection = useCallback(
        (presetId: string) => {
            setSelectedModel(presetId);
            if (projectId) {
                createProjectApi(getToken)
                    .update(projectId, { preferred_model: presetId })
                    .then(() => {
                        globalMutate(
                            projectKeys.detail(projectId),
                            (prev: Record<string, unknown> | undefined) =>
                                prev ? { ...prev, preferredModel: presetId } : prev,
                            { revalidate: false },
                        );
                    })
                    .catch((err) => console.error('Failed to persist model preference:', err));
            }
        },
        [projectId, getToken, globalMutate],
    );

    const isModelAvailable = useMemo(() => {
        if (isLoading || !availablePresets.length) return true; // Optimistic while loading
        return availablePresets.some((preset) => preset.id === (selectedModel ?? defaultPresetId));
    }, [selectedModel, availablePresets, isLoading, defaultPresetId]);

    return (
        <ModelSelectionContext.Provider
            value={{
                selectedModel: selectedModel ?? defaultPresetId,
                setSelectedModel,
                persistSelection,
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
