'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useReducer } from 'react';

export type PanelState =
    | { panel: 'artifact-preview'; artifactId: string; artifactKey: string; version: number }
    | { panel: 'file-preview'; artifactId: string }
    | { panel: 'file-preview'; fileUrl: string; fileName: string; mimeType: string }
    | { panel: 'artifacts' }
    | { panel: 'resources' }
    | null;

export type PanelAction =
    | { type: 'PUSH'; panel: NonNullable<PanelState> }
    | { type: 'POP' }
    | { type: 'RESET'; panel: NonNullable<PanelState> }
    | { type: 'CLOSE' }
    | { type: 'TOGGLE'; panel: NonNullable<PanelState> };

type PanelStack = NonNullable<PanelState>[];

export function panelReducer(stack: PanelStack, action: PanelAction): PanelStack {
    switch (action.type) {
        case 'PUSH':
            return [...stack, action.panel];
        case 'POP':
            return stack.length <= 1 ? [] : stack.slice(0, -1);
        case 'RESET':
            return [action.panel];
        case 'CLOSE':
            return [];
        case 'TOGGLE': {
            const top = stack[stack.length - 1];
            return top?.panel === action.panel.panel ? [] : [action.panel];
        }
        default:
            return stack;
    }
}

export type PushPanelOptions = { reset?: boolean };

export type ActivePanelContextValue = {
    panelState: PanelState;
    canGoBack: boolean;
    pushPanel: (state: NonNullable<PanelState>, options?: PushPanelOptions) => void;
    popPanel: () => void;
    closePanel: () => void;
    togglePanel: (state: NonNullable<PanelState>) => void;
};

const ActivePanelContext = createContext<ActivePanelContextValue | null>(null);

export function ActivePanelProvider({ children }: { children: ReactNode }) {
    const [stack, dispatch] = useReducer(panelReducer, []);

    const panelState: PanelState = stack.length > 0 ? stack[stack.length - 1]! : null;
    const canGoBack = stack.length > 1;

    const pushPanel = useCallback((state: NonNullable<PanelState>, options?: PushPanelOptions) => {
        dispatch(options?.reset ? { type: 'RESET', panel: state } : { type: 'PUSH', panel: state });
    }, []);

    const popPanel = useCallback(() => {
        dispatch({ type: 'POP' });
    }, []);

    const closePanel = useCallback(() => {
        dispatch({ type: 'CLOSE' });
    }, []);

    const togglePanel = useCallback((state: NonNullable<PanelState>) => {
        dispatch({ type: 'TOGGLE', panel: state });
    }, []);

    const value = useMemo(
        () => ({ panelState, canGoBack, pushPanel, popPanel, closePanel, togglePanel }),
        [panelState, canGoBack, pushPanel, popPanel, closePanel, togglePanel],
    );

    return <ActivePanelContext.Provider value={value}>{children}</ActivePanelContext.Provider>;
}

export function useActivePanelContext(): ActivePanelContextValue {
    const context = useContext(ActivePanelContext);
    if (!context) {
        throw new Error('useActivePanelContext must be used within an ActivePanelProvider');
    }
    return context;
}
