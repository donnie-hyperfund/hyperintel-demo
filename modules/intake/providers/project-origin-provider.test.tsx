// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ProjectOrigin } from '@/lib/intake/project-origin';
import { ProjectOriginProvider, useOptionalProjectOrigin } from './project-origin-provider';

const getTokenMock = vi.fn();
const pushMock = vi.fn();
const toastMock = vi.fn();
const importArtifactsMock = vi.fn();

vi.mock('@clerk/nextjs', () => ({
    useAuth: () => ({ getToken: getTokenMock }),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/hooks/use-toast', () => ({
    toast: (...args: Parameters<typeof toastMock>) => toastMock(...args),
}));

vi.mock('@/lib/api/requests/worker/projects', () => ({
    importArtifacts: (...args: Parameters<typeof importArtifactsMock>) => importArtifactsMock(...args),
}));

const ORIGIN: ProjectOrigin = {
    origin: 'project',
    projectId: '00000000-0000-0000-0000-000000000001',
    sourceChatId: '00000000-0000-0000-0000-000000000002',
};

const ARTIFACT_ID = '00000000-0000-0000-0000-a00000000001';
const NEW_ARTIFACT_ID = '00000000-0000-0000-0000-a00000000002';
const NEW_VERSION_ID = '00000000-0000-0000-0000-a00000000003';

function wrapper(origin: ProjectOrigin | null, resourceType: 'company' | 'stakeholder' = 'company') {
    return ({ children }: { children: ReactNode }) => (
        <ProjectOriginProvider origin={origin} resourceType={resourceType}>
            {children}
        </ProjectOriginProvider>
    );
}

describe('useOptionalProjectOrigin', () => {
    beforeEach(() => {
        getTokenMock.mockReset();
        getTokenMock.mockResolvedValue('token-abc');
        pushMock.mockReset();
        toastMock.mockReset();
        importArtifactsMock.mockReset();
    });

    it('returns empty defaults when used outside the provider', () => {
        const { result } = renderHook(() => useOptionalProjectOrigin());

        expect(result.current.origin).toBeNull();
        expect(result.current.isProjectFlow).toBe(false);
        expect(result.current.backHref).toBeNull();
        expect(result.current.parent).toBeNull();
        expect(result.current.infoText).toBeNull();
        expect(result.current.isLinking).toBe(false);
    });

    it('provides non-project-flow values when origin is null', () => {
        const { result } = renderHook(() => useOptionalProjectOrigin(), { wrapper: wrapper(null) });

        expect(result.current.isProjectFlow).toBe(false);
        expect(result.current.backHref).toBeNull();
        expect(result.current.parent).toBeNull();
        expect(result.current.infoText).toBeNull();
    });

    it('provides project-flow values when origin is present', () => {
        const { result } = renderHook(() => useOptionalProjectOrigin(), { wrapper: wrapper(ORIGIN) });

        expect(result.current.isProjectFlow).toBe(true);
        expect(result.current.backHref).toContain(`/${ORIGIN.projectId}/${ORIGIN.sourceChatId}`);
        expect(result.current.parent).toEqual({ label: 'Project', href: result.current.backHref });
        expect(result.current.infoText).toContain('company profile');
    });

    it('uses stakeholder label when resourceType is stakeholder', () => {
        const { result } = renderHook(() => useOptionalProjectOrigin(), {
            wrapper: wrapper(ORIGIN, 'stakeholder'),
        });

        expect(result.current.infoText).toContain('stakeholder profile');
    });

    it('handleApprovedArtifact is a no-op when origin is null', async () => {
        const { result } = renderHook(() => useOptionalProjectOrigin(), { wrapper: wrapper(null) });

        await act(async () => {
            await result.current.handleApprovedArtifact({ id: ARTIFACT_ID, key: 'key-1' });
        });

        expect(importArtifactsMock).not.toHaveBeenCalled();
    });

    it('imports artifact and navigates on successful approval', async () => {
        importArtifactsMock.mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    imported: 1,
                    skipped: 0,
                    details: [
                        {
                            sourceArtifactId: ARTIFACT_ID,
                            newArtifactId: NEW_ARTIFACT_ID,
                            newVersionId: NEW_VERSION_ID,
                            key: 'resolved-key',
                            status: 'imported',
                        },
                    ],
                }),
        });

        const { result } = renderHook(() => useOptionalProjectOrigin(), { wrapper: wrapper(ORIGIN) });

        await act(async () => {
            await result.current.handleApprovedArtifact({ id: ARTIFACT_ID, key: 'key-1' });
        });

        expect(importArtifactsMock).toHaveBeenCalledWith(
            { projectId: ORIGIN.projectId, artifactIds: [ARTIFACT_ID] },
            'token-abc',
        );

        expect(toastMock).toHaveBeenCalledWith(
            expect.objectContaining({ title: expect.stringContaining('approved and added') }),
        );

        expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('highlightResource=resolved-key'));
    });

    it('shows duplicate toast when artifact was already linked', async () => {
        importArtifactsMock.mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    imported: 0,
                    skipped: 1,
                    details: [{ sourceArtifactId: ARTIFACT_ID, key: 'key-1', status: 'skipped_duplicate' }],
                }),
        });

        const { result } = renderHook(() => useOptionalProjectOrigin(), { wrapper: wrapper(ORIGIN) });

        await act(async () => {
            await result.current.handleApprovedArtifact({ id: ARTIFACT_ID, key: 'key-1' });
        });

        expect(toastMock).toHaveBeenCalledWith(
            expect.objectContaining({ title: expect.stringContaining('already exists') }),
        );
    });

    it('shows destructive toast on network error and does not navigate', async () => {
        importArtifactsMock.mockRejectedValue(new Error('Network failure'));

        const { result } = renderHook(() => useOptionalProjectOrigin(), { wrapper: wrapper(ORIGIN) });

        await act(async () => {
            await result.current.handleApprovedArtifact({ id: ARTIFACT_ID, key: 'key-1' });
        });

        expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
        expect(pushMock).not.toHaveBeenCalled();
    });

    it('manages isLinking state during the async operation', async () => {
        let resolveImport!: (value: unknown) => void;
        importArtifactsMock.mockReturnValue(
            new Promise((resolve) => {
                resolveImport = resolve;
            }),
        );

        const { result } = renderHook(() => useOptionalProjectOrigin(), { wrapper: wrapper(ORIGIN) });

        expect(result.current.isLinking).toBe(false);

        let approvalPromise: Promise<void>;
        act(() => {
            approvalPromise = result.current.handleApprovedArtifact({ id: ARTIFACT_ID, key: 'key-1' });
        });

        await waitFor(() => {
            expect(result.current.isLinking).toBe(true);
        });

        await act(async () => {
            resolveImport({
                ok: true,
                json: () =>
                    Promise.resolve({
                        imported: 1,
                        skipped: 0,
                        details: [{ sourceArtifactId: ARTIFACT_ID, key: 'key-1', status: 'imported' }],
                    }),
            });
            await approvalPromise!;
        });

        expect(result.current.isLinking).toBe(false);
    });

    it('shows error toast when API returns non-ok response with message', async () => {
        importArtifactsMock.mockResolvedValue({
            ok: false,
            json: () => Promise.resolve({ message: 'Quota exceeded' }),
        });

        const { result } = renderHook(() => useOptionalProjectOrigin(), { wrapper: wrapper(ORIGIN) });

        await act(async () => {
            await result.current.handleApprovedArtifact({ id: ARTIFACT_ID, key: 'key-1' });
        });

        expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
        expect(pushMock).not.toHaveBeenCalled();
    });
});
