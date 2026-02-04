'use client';

import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

export type PanelState =
    | { panel: 'artifact-preview'; artifactId: string; version: number }
    | { panel: 'artifacts' }
    | { panel: 'resources' }
    | null;

export type ActivePanelContextValue = {
    panelState: PanelState;
    openPanel: (state: PanelState) => void;
    closePanel: () => void;
    togglePanel: (state: NonNullable<PanelState>) => void;
};

const ActivePanelContext = createContext<ActivePanelContextValue | null>(null);

export function ActivePanelProvider({ children }: { children: ReactNode }) {
    const [panelState, setPanelState] = useState<PanelState>(null);

    const openPanel = useCallback((state: PanelState) => {
        setPanelState(state);
    }, []);

    const closePanel = useCallback(() => {
        setPanelState(null);
    }, []);

    const togglePanel = useCallback((state: NonNullable<PanelState>) => {
        setPanelState((prev) => (prev?.panel === state.panel ? null : state));
    }, []);

    return (
        <ActivePanelContext.Provider value={{ panelState, openPanel, closePanel, togglePanel }}>
            {children}
        </ActivePanelContext.Provider>
    );
}

export function useActivePanelContext(): ActivePanelContextValue {
    const context = useContext(ActivePanelContext);
    if (!context) {
        throw new Error('useActivePanelContext must be used within an ActivePanelProvider');
    }
    return context;
}
