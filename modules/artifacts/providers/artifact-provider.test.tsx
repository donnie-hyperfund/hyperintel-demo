// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Artifact } from '@/modules/chat/types';
import { ArtifactProvider, useArtifactContext } from './artifact-provider';

function wrapper({ children }: { children: ReactNode }) {
    return <ArtifactProvider>{children}</ArtifactProvider>;
}

function buildArtifact(id: string, content = 'initial'): Artifact {
    return {
        id,
        key: id,
        title: `Artifact ${id}`,
        version: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        current_version: {
            id: `${id}-current`,
            version: 0,
            content: 'approved-content',
            status: 'approved',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
        },
        proposed_version: {
            id: `${id}-proposed`,
            version: 1,
            content,
            status: 'proposed',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
        },
    };
}

describe('ArtifactProvider', () => {
    it('throws when hook is used outside provider', () => {
        expect(() => renderHook(() => useArtifactContext())).toThrow(
            'useArtifacts must be used within an ArtifactProvider',
        );
    });

    it('adds and reads artifacts by id and version key', () => {
        const { result } = renderHook(() => useArtifactContext(), { wrapper });
        const artifact = buildArtifact('artifact-1', 'v1-content');

        act(() => {
            result.current.addArtifact(artifact, 1);
        });

        expect(result.current.getArtifact('artifact-1', 1)).toEqual(artifact);
        expect(result.current.getArtifact('missing')).toBeNull();
    });

    it('deep merges version updates by default', () => {
        const { result } = renderHook(() => useArtifactContext(), { wrapper });
        const artifact = buildArtifact('artifact-2', 'before');

        act(() => {
            result.current.addArtifact(artifact);
        });

        act(() => {
            result.current.updateArtifact('artifact-2', {
                proposed_version: {
                    content: 'after',
                },
                current_version: {
                    status: 'rejected',
                },
                isStreaming: true,
            });
        });

        const updated = result.current.getArtifact('artifact-2');
        expect(updated?.proposed_version?.content).toBe('after');
        expect(updated?.proposed_version?.version).toBe(1);
        expect(updated?.current_version?.status).toBe('rejected');
        expect(updated?.current_version?.version).toBe(0);
        expect(updated?.isStreaming).toBe(true);
    });

    it('supports replacement updates when merge is false', () => {
        const { result } = renderHook(() => useArtifactContext(), { wrapper });
        const original = buildArtifact('artifact-3', 'old');
        const replacement = buildArtifact('artifact-3', 'new');

        act(() => {
            result.current.addArtifact(original);
        });

        act(() => {
            result.current.updateArtifact('artifact-3', replacement, 'latest', { merge: false });
        });

        expect(result.current.getArtifact('artifact-3')).toEqual(replacement);
    });

    it('ignores updates for missing artifacts', () => {
        const { result } = renderHook(() => useArtifactContext(), { wrapper });
        const before = result.current.getStore();

        act(() => {
            result.current.updateArtifact('missing-artifact', { isStreaming: true });
        });

        expect(result.current.getStore()).toBe(before);
    });

    it('does not rewrite state when artifact content and streaming flags are unchanged', () => {
        const { result } = renderHook(() => useArtifactContext(), { wrapper });
        const artifact = buildArtifact('artifact-4', 'same-content');

        act(() => {
            result.current.addArtifact(artifact);
        });
        const firstStore = result.current.getStore();

        act(() => {
            result.current.addArtifact({
                ...artifact,
                // Different object identity, same content/flags
                proposed_version: { ...artifact.proposed_version! },
            });
        });

        expect(result.current.getStore()).toBe(firstStore);
    });
});
