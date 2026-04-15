// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ModelSelectionProvider, useModelSelection } from './model-selection-provider';

vi.mock('@clerk/nextjs', () => ({
    useAuth: () => ({ getToken: vi.fn().mockResolvedValue('mock-token') }),
}));

vi.mock('@/lib/config', () => ({
    IS_DEV: true,
    IS_PROD: false,
}));

vi.mock('@/lib/api/client/hooks/use-presets', () => ({
    usePresets: () => ({
        data: {
            presets: [
                { id: 'sonnet', label: 'Sonnet' },
                { id: 'haiku', label: 'Haiku' },
            ],
            defaultPresetId: 'sonnet',
        },
        isLoading: false,
    }),
}));

vi.mock('@/lib/api/client/hooks/use-projects', () => ({
    useFetchProject: () => ({ data: null }),
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

        expect(result.current.selectedModel).toBe('sonnet');

        act(() => {
            result.current.setSelectedModel('haiku');
        });

        expect(result.current.selectedModel).toBe('haiku');
    });
});
