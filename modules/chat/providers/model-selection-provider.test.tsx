// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DEFAULT_PRESET_ID } from '@/lib/presets';
import { ModelSelectionProvider, useModelSelection } from './model-selection-provider';

vi.mock('@/lib/config', () => ({
    IS_DEV: true,
    IS_PROD: false,
}));

function wrapper({ children }: { children: ReactNode }) {
    return <ModelSelectionProvider>{children}</ModelSelectionProvider>;
}

describe('ModelSelectionProvider', () => {
    it('throws when hook is used outside provider', () => {
        expect(() => renderHook(() => useModelSelection())).toThrow(
            'useModelSelection must be used within a ModelSelectionProvider',
        );
    });

    it('starts with default preset and allows updates', () => {
        const { result } = renderHook(() => useModelSelection(), { wrapper });

        expect(result.current.selectedModel).toBe(DEFAULT_PRESET_ID);

        act(() => {
            result.current.setSelectedModel('haiku');
        });

        expect(result.current.selectedModel).toBe('haiku');
    });
});
