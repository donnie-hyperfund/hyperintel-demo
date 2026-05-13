// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadScope } from '@/lib/storage/storage-keys';
import { FileUploadProvider, useFileUploadContext } from './file-upload-provider';

const getTokenMock = vi.fn(async () => 'token');
const mutateMock = vi.fn();
const presignUploadMock = vi.fn();
const confirmUploadMock = vi.fn();
const presignImageUploadMock = vi.fn();
const confirmImageUploadMock = vi.fn();

vi.mock('@clerk/nextjs', () => ({
    useAuth: () => ({ getToken: getTokenMock }),
}));

vi.mock('swr', () => ({
    useSWRConfig: () => ({ mutate: mutateMock }),
}));

vi.mock('@/lib/api/requests/worker/chat', () => ({
    presignUpload: (...args: unknown[]) => presignUploadMock(...args),
    confirmUpload: (...args: unknown[]) => confirmUploadMock(...args),
    presignImageUpload: (...args: unknown[]) => presignImageUploadMock(...args),
    confirmImageUpload: (...args: unknown[]) => confirmImageUploadMock(...args),
    uploadArtifact: vi.fn(),
    deleteArtifact: vi.fn(),
}));

vi.mock('../hooks/use-cross-tab-upload-sync', () => ({
    useCrossTabUploadSync: vi.fn(),
}));

vi.mock('../hooks/use-project-resource-upload-sync', () => ({
    useProjectResourceUploadSync: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
    toast: vi.fn(),
}));

function makeWrapper(scope: UploadScope) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <FileUploadProvider scope={scope}>{children}</FileUploadProvider>;
    };
}

const phaseChatInputScope = (chatId?: string): UploadScope => ({
    kind: 'chat-input',
    chatType: 'phase',
    projectId: '22222222-2222-2222-2222-222222222222',
    ...(chatId ? { chatId } : {}),
});

const intakeNewScope: UploadScope = { kind: 'chat-input', chatType: 'company' };

const projectResourcesScope: UploadScope = {
    kind: 'project-resources',
    projectId: '22222222-2222-2222-2222-222222222222',
};

describe('FileUploadProvider image routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        presignUploadMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                uploadUrl: 'https://upload.test/object',
                artifactId: 'artifact-1',
                versionId: 'version-1',
                fileId: 'file-1',
                key: 'image.png.md',
            }),
        });
        confirmUploadMock.mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
        presignImageUploadMock.mockResolvedValue({
            ok: true,
            json: async () => ({ uploadUrl: 'https://upload.test/chat-image', fileId: 'chat-file-1' }),
        });
        confirmImageUploadMock.mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string | URL | Request) => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
                if (url.includes('/api/artifacts/files/status')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ files: [{ fileId: 'file-1', status: 'processed' }] }),
                    } as Response);
                }

                return Promise.resolve({ ok: true } as Response);
            }),
        );
    });

    it('routes chat-input image file picker uploads to artifact presign by default', async () => {
        const { result } = renderHook(() => useFileUploadContext(), {
            wrapper: makeWrapper(phaseChatInputScope('11111111-1111-1111-1111-111111111111')),
        });

        const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });

        act(() => {
            result.current.addFiles([file]);
        });

        await waitFor(() => expect(presignUploadMock).toHaveBeenCalledTimes(1));

        expect(presignImageUploadMock).not.toHaveBeenCalled();
        expect(presignUploadMock.mock.calls[0]?.[0]).toMatchObject({
            filename: 'photo.png',
            chatId: '11111111-1111-1111-1111-111111111111',
            source: 'chat-input',
        });
    });

    it('marks staged artifact presign uploads ready after confirm without polling for extraction', async () => {
        const { result } = renderHook(() => useFileUploadContext(), {
            wrapper: makeWrapper(intakeNewScope),
        });

        const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });

        act(() => {
            result.current.addFiles([file]);
        });

        await waitFor(() => expect(result.current.files[0]?.status).toBe('ready'));

        expect(result.current.files[0]).toMatchObject({
            artifactId: 'artifact-1',
            fileId: 'file-1',
            requiresAssociation: true,
        });
        expect(presignUploadMock.mock.calls[0]?.[0]).toMatchObject({
            filename: 'photo.png',
            source: 'chat-input',
        });
        expect(
            vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/api/artifacts/files/status')),
        ).toBe(false);
    });

    it('routes pasted chat images through the chat-image upload path', async () => {
        const { result } = renderHook(() => useFileUploadContext(), {
            wrapper: makeWrapper(phaseChatInputScope('11111111-1111-1111-1111-111111111111')),
        });

        const file = new File(['image-bytes'], 'screenshot.png', { type: 'image/png' });

        act(() => {
            result.current.addFiles([file], { source: 'paste' });
        });

        await waitFor(() => expect(presignImageUploadMock).toHaveBeenCalledTimes(1));

        expect(presignUploadMock).not.toHaveBeenCalled();
        expect(presignImageUploadMock.mock.calls[0]?.[0]).toMatchObject({
            filename: 'screenshot.png',
            chatId: '11111111-1111-1111-1111-111111111111',
        });
    });

    it('routes artifact-panel image uploads to artifact presign', async () => {
        const { result } = renderHook(() => useFileUploadContext(), {
            wrapper: makeWrapper(projectResourcesScope),
        });

        const file = new File(['image-bytes'], 'diagram.png', { type: 'image/png' });

        act(() => {
            result.current.addFiles([file]);
        });

        await waitFor(() => expect(presignUploadMock).toHaveBeenCalledTimes(1));

        expect(presignImageUploadMock).not.toHaveBeenCalled();
        expect(presignUploadMock.mock.calls[0]?.[0]).toMatchObject({
            filename: 'diagram.png',
            projectId: '22222222-2222-2222-2222-222222222222',
            source: 'project-resources',
        });
    });
});

describe('FileUploadProvider message attachments snapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        presignUploadMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                uploadUrl: 'https://upload.test/object',
                artifactId: 'artifact-1',
                versionId: 'version-1',
                fileId: 'file-1',
                key: 'doc.pdf',
            }),
        });
        confirmUploadMock.mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string | URL | Request) => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
                if (url.includes('/api/artifacts/files/status')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ files: [{ fileId: 'file-1', status: 'processed' }] }),
                    } as Response);
                }
                return Promise.resolve({ ok: true } as Response);
            }),
        );
    });

    it('returns the artifact for chat-input uploads with full scope, no association needed', async () => {
        const { result } = renderHook(() => useFileUploadContext(), {
            wrapper: makeWrapper(phaseChatInputScope('11111111-1111-1111-1111-111111111111')),
        });

        const file = new File(['pdf-bytes'], 'doc.pdf', { type: 'application/pdf' });

        act(() => {
            result.current.addFiles([file]);
        });

        await waitFor(() => expect(result.current.files[0]?.artifactId).toBe('artifact-1'));

        const attachments = result.current.getMessageAttachments();
        expect(attachments.artifactIds).toEqual(['artifact-1']);
        expect(attachments.requiresAssociationIds).toEqual([]);
        expect(attachments.imageFileIds).toEqual([]);
    });

    it('flags intake-pre-chat uploads as requiring association', async () => {
        const { result } = renderHook(() => useFileUploadContext(), {
            wrapper: makeWrapper(intakeNewScope),
        });

        const file = new File(['pdf-bytes'], 'doc.pdf', { type: 'application/pdf' });

        act(() => {
            result.current.addFiles([file]);
        });

        await waitFor(() => expect(result.current.files[0]?.artifactId).toBe('artifact-1'));

        const attachments = result.current.getMessageAttachments();
        expect(attachments.artifactIds).toEqual(['artifact-1']);
        expect(attachments.requiresAssociationIds).toEqual(['artifact-1']);
    });

    it('returns empty lists for project-resources uploads', async () => {
        const { result } = renderHook(() => useFileUploadContext(), {
            wrapper: makeWrapper(projectResourcesScope),
        });

        const file = new File(['pdf-bytes'], 'doc.pdf', { type: 'application/pdf' });

        act(() => {
            result.current.addFiles([file]);
        });

        await waitFor(() => expect(result.current.files[0]?.artifactId).toBe('artifact-1'));

        const attachments = result.current.getMessageAttachments();
        expect(attachments.artifactIds).toEqual(['artifact-1']);
        expect(attachments.requiresAssociationIds).toEqual([]);
    });
});
