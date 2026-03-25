// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ScrollTargetProvider, useScrollTargetContext } from './scroll-target-provider';

type Target = { key: string; version: number | null };

let mockedTarget: Target | null = null;
const clearParamsMock = vi.fn();

vi.mock('@/hooks/use-scroll-to-artifact-param', () => ({
    useScrollToArtifactParam: () => ({
        target: mockedTarget,
        clear: clearParamsMock,
    }),
}));

function wrapper({ children }: { children: ReactNode }) {
    return <ScrollTargetProvider>{children}</ScrollTargetProvider>;
}

describe('ScrollTargetProvider', () => {
    beforeEach(() => {
        mockedTarget = null;
        clearParamsMock.mockReset();
    });

    it('returns empty default state when no URL target exists', () => {
        const { result } = renderHook(() => useScrollTargetContext(), { wrapper });

        expect(result.current.target).toBeNull();
        expect(result.current.foundRef.current).toBe(false);
        expect(clearParamsMock).not.toHaveBeenCalled();
    });

    it('absorbs URL target and clears URL params once', async () => {
        mockedTarget = { key: 'artifact-key', version: 7 };

        const { result } = renderHook(() => useScrollTargetContext(), { wrapper });

        await waitFor(() => {
            expect(result.current.target).toEqual({ key: 'artifact-key', version: 7 });
        });

        expect(clearParamsMock).toHaveBeenCalledTimes(1);
    });

    it('tracks found state and clears local target state', async () => {
        mockedTarget = { key: 'artifact-key', version: 2 };
        const { result } = renderHook(() => useScrollTargetContext(), { wrapper });

        await waitFor(() => {
            expect(result.current.target).toEqual({ key: 'artifact-key', version: 2 });
        });

        act(() => {
            result.current.markFound();
        });
        expect(result.current.foundRef.current).toBe(true);

        act(() => {
            result.current.clear();
        });
        expect(result.current.target).toBeNull();
        expect(result.current.foundRef.current).toBe(false);
    });
});
