// @vitest-environment jsdom

import { ANTHROPIC_MODELS } from '@common/ai/types';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
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

    it('starts with SONNET and allows model updates', () => {
        const { result } = renderHook(() => useModelSelection(), { wrapper });

        expect(result.current.selectedModel).toBe(ANTHROPIC_MODELS.SONNET);

        act(() => {
            result.current.setSelectedModel(ANTHROPIC_MODELS.HAIKU);
        });

        expect(result.current.selectedModel).toBe(ANTHROPIC_MODELS.HAIKU);
    });
});
