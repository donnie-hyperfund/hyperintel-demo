// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PendingUploadsProvider, usePendingUploads } from './pending-uploads-provider';

function wrapper({ children }: { children: ReactNode }) {
    return <PendingUploadsProvider>{children}</PendingUploadsProvider>;
}

describe('PendingUploadsProvider', () => {
    it('throws when hook is used outside provider', () => {
        expect(() => renderHook(() => usePendingUploads())).toThrow(
            'usePendingUploads must be used within a PendingUploadsProvider',
        );
    });

    it('starts with an empty list', () => {
        const { result } = renderHook(() => usePendingUploads(), { wrapper });

        expect(result.current.pendingArtifactIds).toEqual([]);
    });

    it('adds a single artifact id', () => {
        const { result } = renderHook(() => usePendingUploads(), { wrapper });

        act(() => {
            result.current.addPendingArtifactId('artifact-1');
        });

        expect(result.current.pendingArtifactIds).toEqual(['artifact-1']);
    });

    it('accumulates multiple artifact ids', () => {
        const { result } = renderHook(() => usePendingUploads(), { wrapper });

        act(() => {
            result.current.addPendingArtifactId('artifact-1');
        });
        act(() => {
            result.current.addPendingArtifactId('artifact-2');
        });
        act(() => {
            result.current.addPendingArtifactId('artifact-3');
        });

        expect(result.current.pendingArtifactIds).toEqual(['artifact-1', 'artifact-2', 'artifact-3']);
    });

    it('clears all pending ids', () => {
        const { result } = renderHook(() => usePendingUploads(), { wrapper });

        act(() => {
            result.current.addPendingArtifactId('artifact-1');
            result.current.addPendingArtifactId('artifact-2');
        });

        act(() => {
            result.current.clearPendingArtifactIds();
        });

        expect(result.current.pendingArtifactIds).toEqual([]);
    });

    it('can add ids again after clearing', () => {
        const { result } = renderHook(() => usePendingUploads(), { wrapper });

        act(() => {
            result.current.addPendingArtifactId('artifact-1');
        });
        act(() => {
            result.current.clearPendingArtifactIds();
        });
        act(() => {
            result.current.addPendingArtifactId('artifact-2');
        });

        expect(result.current.pendingArtifactIds).toEqual(['artifact-2']);
    });

    it('does not deduplicate ids', () => {
        const { result } = renderHook(() => usePendingUploads(), { wrapper });

        act(() => {
            result.current.addPendingArtifactId('artifact-1');
            result.current.addPendingArtifactId('artifact-1');
        });

        expect(result.current.pendingArtifactIds).toEqual(['artifact-1', 'artifact-1']);
    });
});
