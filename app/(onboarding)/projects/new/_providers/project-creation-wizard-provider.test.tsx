// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ProjectCreationWizardProvider, useProjectCreationWizard } from './project-creation-wizard-provider';

let mockUser: { id: string } | null = { id: 'user-1' };
const getTokenMock = vi.fn<() => Promise<string | null>>().mockResolvedValue('token-1');
const pushMock = vi.fn();
const toastMock = vi.fn();
const createProjectMock = vi.fn();
const createProjectApiMock = vi.fn(() => ({ create: createProjectMock }));
const importArtifactsMock = vi.fn();
const setCurrentProjectCookieMock = vi.fn();

vi.mock('@clerk/nextjs', () => ({
    useUser: () => ({ user: mockUser }),
    useAuth: () => ({ getToken: getTokenMock }),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/hooks/use-toast', () => ({
    toast: (...args: Parameters<typeof toastMock>) => toastMock(...args),
}));

vi.mock('@/lib/api/client/fetchers/projects', () => ({
    createProjectApi: (...args: Parameters<typeof createProjectApiMock>) => createProjectApiMock(...args),
}));

vi.mock('@/lib/api/requests/worker/projects', () => ({
    importArtifacts: (...args: Parameters<typeof importArtifactsMock>) => importArtifactsMock(...args),
}));

vi.mock('@/lib/cookies/project', () => ({
    setCurrentProjectCookie: (...args: Parameters<typeof setCurrentProjectCookieMock>) =>
        setCurrentProjectCookieMock(...args),
}));

function wrapper({ children }: { children: ReactNode }) {
    return <ProjectCreationWizardProvider>{children}</ProjectCreationWizardProvider>;
}

describe('ProjectCreationWizardProvider', () => {
    beforeEach(() => {
        mockUser = { id: 'user-1' };
        getTokenMock.mockReset();
        getTokenMock.mockResolvedValue('token-1');
        pushMock.mockReset();
        toastMock.mockReset();
        createProjectMock.mockReset();
        createProjectApiMock.mockClear();
        importArtifactsMock.mockReset();
        setCurrentProjectCookieMock.mockReset();
    });

    it('throws when hook is used outside provider', () => {
        expect(() => renderHook(() => useProjectCreationWizard())).toThrow(
            'useProjectCreationWizard must be used within ProjectCreationWizardProvider',
        );
    });

    it('merges wizard data patches', () => {
        const { result } = renderHook(() => useProjectCreationWizard(), { wrapper });

        act(() => {
            result.current.updateData({ name: 'My Project' });
        });
        act(() => {
            result.current.updateData({ description: 'Description' });
        });

        expect(result.current.data).toEqual({
            name: 'My Project',
            description: 'Description',
        });
    });

    it('shows error toast when user is not authenticated', async () => {
        mockUser = null;
        const { result } = renderHook(() => useProjectCreationWizard(), { wrapper });

        await act(async () => {
            await result.current.submitProject({ name: 'Project without user' });
        });

        expect(toastMock).toHaveBeenCalledWith({
            title: 'You must be logged in to create a project.',
            variant: 'destructive',
        });
        expect(createProjectMock).not.toHaveBeenCalled();
    });

    it('shows error toast when project name is missing', async () => {
        const { result } = renderHook(() => useProjectCreationWizard(), { wrapper });

        await act(async () => {
            await result.current.submitProject({ description: 'No name' });
        });

        expect(toastMock).toHaveBeenCalledWith({
            title: 'Project details are missing.',
            variant: 'destructive',
        });
        expect(createProjectMock).not.toHaveBeenCalled();
    });

    it('creates project, imports selected resources, persists cookie, and redirects', async () => {
        createProjectMock.mockResolvedValue({ id: 'project-123' });
        importArtifactsMock.mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({}),
        });

        const { result } = renderHook(() => useProjectCreationWizard(), { wrapper });

        act(() => {
            result.current.updateData({
                name: 'Critical Project',
                description: 'Critical Description',
                selectedResourceIds: ['artifact-1', 'artifact-2'],
            });
        });

        await act(async () => {
            await result.current.submitProject();
        });

        expect(createProjectApiMock).toHaveBeenCalledWith(getTokenMock);
        expect(createProjectMock).toHaveBeenCalledWith({
            name: 'Critical Project',
            description: 'Critical Description',
        });

        expect(importArtifactsMock).toHaveBeenCalledWith(
            { projectId: 'project-123', artifactIds: ['artifact-1', 'artifact-2'] },
            'token-1',
        );
        expect(toastMock).toHaveBeenCalledWith({ title: 'Project created successfully!' });
        expect(setCurrentProjectCookieMock).toHaveBeenCalledWith('user-1', 'project-123');
        expect(pushMock).toHaveBeenCalledWith('/project-123');

        await waitFor(() => {
            expect(result.current.isSubmitting).toBe(false);
        });
    });

    it('creates project without import step when no resources are selected', async () => {
        createProjectMock.mockResolvedValue({ id: 'project-321' });

        const { result } = renderHook(() => useProjectCreationWizard(), { wrapper });

        await act(async () => {
            await result.current.submitProject({
                name: 'No Import Project',
                description: 'No resources selected',
            });
        });

        expect(createProjectMock).toHaveBeenCalledWith({
            name: 'No Import Project',
            description: 'No resources selected',
        });
        expect(importArtifactsMock).not.toHaveBeenCalled();
        expect(pushMock).toHaveBeenCalledWith('/project-321');
    });

    it('handles import failure and surfaces destructive toast', async () => {
        createProjectMock.mockResolvedValue({ id: 'project-999' });
        importArtifactsMock.mockResolvedValue({
            ok: false,
            json: vi.fn().mockResolvedValue({ message: 'Import failed' }),
        });

        const { result } = renderHook(() => useProjectCreationWizard(), { wrapper });

        await act(async () => {
            await result.current.submitProject({
                name: 'Import Failure Project',
                selectedResourceIds: ['artifact-1'],
            });
        });

        expect(toastMock).toHaveBeenCalledWith({
            title: 'Failed to create project. Please try again.',
            variant: 'destructive',
        });
        expect(pushMock).not.toHaveBeenCalled();
    });
});
