// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ActivePanelProvider, useActivePanelContext } from './active-panel-provider';

function wrapper({ children }: { children: ReactNode }) {
    return <ActivePanelProvider>{children}</ActivePanelProvider>;
}

describe('ActivePanelProvider', () => {
    it('throws when hook is used outside provider', () => {
        expect(() => renderHook(() => useActivePanelContext())).toThrow(
            'useActivePanelContext must be used within an ActivePanelProvider',
        );
    });

    it('opens, toggles, and closes panels', () => {
        const { result } = renderHook(() => useActivePanelContext(), { wrapper });

        expect(result.current.panelState).toBeNull();

        act(() => {
            result.current.openPanel({ panel: 'artifacts' });
        });
        expect(result.current.panelState).toEqual({ panel: 'artifacts' });

        act(() => {
            result.current.togglePanel({ panel: 'artifacts' });
        });
        expect(result.current.panelState).toBeNull();

        act(() => {
            result.current.togglePanel({ panel: 'artifact-preview', artifactId: 'artifact-1', version: 3 });
        });
        expect(result.current.panelState).toEqual({
            panel: 'artifact-preview',
            artifactId: 'artifact-1',
            version: 3,
        });

        act(() => {
            result.current.closePanel();
        });
        expect(result.current.panelState).toBeNull();
    });
});
