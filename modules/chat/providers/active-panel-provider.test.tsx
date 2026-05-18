// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ActivePanelProvider, type PanelState, panelReducer, useActivePanelContext } from './active-panel-provider';

// ---------------------------------------------------------------------------
// Pure reducer tests
// ---------------------------------------------------------------------------

describe('panelReducer', () => {
    const artifacts: NonNullable<PanelState> = { panel: 'artifacts' };
    const resources: NonNullable<PanelState> = { panel: 'resources' };
    const preview: NonNullable<PanelState> = {
        panel: 'artifact-preview',
        artifactId: 'artifact-id-1',
        artifactKey: 'a1',
        version: 1,
    };
    const filePreview: NonNullable<PanelState> = { panel: 'file-preview', artifactId: 'f1' };

    it('PUSH appends to the stack', () => {
        expect(panelReducer([], { type: 'PUSH', panel: artifacts })).toEqual([artifacts]);
        expect(panelReducer([resources], { type: 'PUSH', panel: preview })).toEqual([resources, preview]);
    });

    it('POP removes the top entry', () => {
        expect(panelReducer([resources, preview], { type: 'POP' })).toEqual([resources]);
    });

    it('POP on single-entry stack returns empty', () => {
        expect(panelReducer([artifacts], { type: 'POP' })).toEqual([]);
    });

    it('POP on empty stack stays empty', () => {
        expect(panelReducer([], { type: 'POP' })).toEqual([]);
    });

    it('RESET replaces the entire stack with one entry', () => {
        expect(panelReducer([resources, preview], { type: 'RESET', panel: filePreview })).toEqual([filePreview]);
        expect(panelReducer([], { type: 'RESET', panel: artifacts })).toEqual([artifacts]);
    });

    it('CLOSE empties the stack', () => {
        expect(panelReducer([resources, preview], { type: 'CLOSE' })).toEqual([]);
        expect(panelReducer([], { type: 'CLOSE' })).toEqual([]);
    });

    it('TOGGLE closes when top has the same panel type', () => {
        expect(panelReducer([artifacts], { type: 'TOGGLE', panel: artifacts })).toEqual([]);
    });

    it('TOGGLE resets to new panel when types differ', () => {
        expect(panelReducer([artifacts], { type: 'TOGGLE', panel: resources })).toEqual([resources]);
    });

    it('TOGGLE on empty stack opens the panel', () => {
        expect(panelReducer([], { type: 'TOGGLE', panel: artifacts })).toEqual([artifacts]);
    });
});

// ---------------------------------------------------------------------------
// Integration tests (React hook)
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
    return <ActivePanelProvider>{children}</ActivePanelProvider>;
}

describe('ActivePanelProvider', () => {
    it('throws when hook is used outside provider', () => {
        expect(() => renderHook(() => useActivePanelContext())).toThrow(
            'useActivePanelContext must be used within an ActivePanelProvider',
        );
    });

    it('starts with null panelState and canGoBack false', () => {
        const { result } = renderHook(() => useActivePanelContext(), { wrapper });
        expect(result.current.panelState).toBeNull();
        expect(result.current.canGoBack).toBe(false);
    });

    it('pushPanel adds to stack', () => {
        const { result } = renderHook(() => useActivePanelContext(), { wrapper });

        act(() => result.current.pushPanel({ panel: 'resources' }));
        expect(result.current.panelState).toEqual({ panel: 'resources' });
        expect(result.current.canGoBack).toBe(false);

        act(() => result.current.pushPanel({ panel: 'file-preview', artifactId: 'f1' }));
        expect(result.current.panelState).toEqual({ panel: 'file-preview', artifactId: 'f1' });
        expect(result.current.canGoBack).toBe(true);
    });

    it('pushPanel with reset clears history and sets single entry', () => {
        const { result } = renderHook(() => useActivePanelContext(), { wrapper });

        act(() => result.current.pushPanel({ panel: 'artifacts' }));
        act(() =>
            result.current.pushPanel({
                panel: 'artifact-preview',
                artifactId: 'artifact-id-1',
                artifactKey: 'a1',
                version: 1,
            }),
        );
        act(() => result.current.pushPanel({ panel: 'resources' }, { reset: true }));

        expect(result.current.panelState).toEqual({ panel: 'resources' });
        expect(result.current.canGoBack).toBe(false);
    });

    it('popPanel returns to previous panel', () => {
        const { result } = renderHook(() => useActivePanelContext(), { wrapper });

        act(() => result.current.pushPanel({ panel: 'artifacts' }));
        act(() =>
            result.current.pushPanel({
                panel: 'artifact-preview',
                artifactId: 'artifact-id-1',
                artifactKey: 'a1',
                version: 1,
            }),
        );
        expect(result.current.canGoBack).toBe(true);

        act(() => result.current.popPanel());
        expect(result.current.panelState).toEqual({ panel: 'artifacts' });
        expect(result.current.canGoBack).toBe(false);

        act(() => result.current.popPanel());
        expect(result.current.panelState).toBeNull();
    });

    it('togglePanel closes when same type, resets when different', () => {
        const { result } = renderHook(() => useActivePanelContext(), { wrapper });

        act(() => result.current.togglePanel({ panel: 'artifacts' }));
        expect(result.current.panelState).toEqual({ panel: 'artifacts' });

        act(() => result.current.togglePanel({ panel: 'artifacts' }));
        expect(result.current.panelState).toBeNull();

        act(() =>
            result.current.togglePanel({
                panel: 'artifact-preview',
                artifactId: 'artifact-id-1',
                artifactKey: 'a1',
                version: 3,
            }),
        );
        expect(result.current.panelState).toEqual({
            panel: 'artifact-preview',
            artifactId: 'artifact-id-1',
            artifactKey: 'a1',
            version: 3,
        });
    });

    it('closePanel empties the entire stack', () => {
        const { result } = renderHook(() => useActivePanelContext(), { wrapper });

        act(() => result.current.pushPanel({ panel: 'artifacts' }));
        act(() =>
            result.current.pushPanel({
                panel: 'artifact-preview',
                artifactId: 'artifact-id-1',
                artifactKey: 'a1',
                version: 1,
            }),
        );
        act(() => result.current.closePanel());

        expect(result.current.panelState).toBeNull();
        expect(result.current.canGoBack).toBe(false);
    });
});
