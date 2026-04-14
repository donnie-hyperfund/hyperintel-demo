// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelSelectionProvider, useModelSelection } from './model-selection-provider';

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

function wrapper({ children }: { children: ReactNode }) {
    return <ModelSelectionProvider>{children}</ModelSelectionProvider>;
}

describe('ModelSelectionProvider', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

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

    it('hydrates stored selection after mount', async () => {
        window.localStorage.setItem('hyperintel:project-model-selection:project-123', 'haiku');

        const projectWrapper = ({ children }: { children: ReactNode }) => (
            <ModelSelectionProvider projectId="project-123">{children}</ModelSelectionProvider>
        );

        const { result } = renderHook(() => useModelSelection(), { wrapper: projectWrapper });

        expect(result.current.selectedModel).toBe('sonnet');

        await waitFor(() => {
            expect(result.current.selectedModel).toBe('haiku');
        });
    });
});
