import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicError } from '@common/common/error.helpers';

// ---- Mocks ------------------------------------------------------------------

vi.mock('@/lib/env', () => ({
    frontendEnv: {
        NEXT_PUBLIC_LOCAL_WORKERS: true,
        NEXT_PUBLIC_CLOUDFLARE_BASE: '',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_mock',
    },
}));

const associateArtifactsInternalMock = vi.fn();
const associateImagesInternalMock = vi.fn();
const resolveScopeMock = vi.fn();

vi.mock('./artifact-uploader', () => ({
    associateArtifactsInternal: (...args: unknown[]) => associateArtifactsInternalMock(...args),
}));

vi.mock('./image-uploader', () => ({
    associateImagesInternal: (...args: unknown[]) => associateImagesInternalMock(...args),
}));

vi.mock('./scope', () => ({
    resolveScope: (...args: unknown[]) => resolveScopeMock(...args),
}));

import { associateUploadsHandler } from './associate-handler';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '22222222-2222-2222-2222-222222222222';
const ARTIFACT_ID = '33333333-3333-3333-3333-333333333333';
const IMAGE_ID = '44444444-4444-4444-4444-444444444444';

function makeCtx() {
    return {
        em: {} as any,
        user: { userId: 'clerk-user-1' } as any,
        env: {} as any,
    } as any;
}

describe('associateUploadsHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveScopeMock.mockResolvedValue({ dbUserId: 'db-user-1' });
    });

    it('rejects when neither chatId nor projectId is provided', async () => {
        await expect(
            associateUploadsHandler({ artifactIds: [ARTIFACT_ID] } as any, makeCtx()),
        ).rejects.toBeInstanceOf(PublicError);
        expect(resolveScopeMock).not.toHaveBeenCalled();
    });

    it('dispatches to both pipelines and sums their results', async () => {
        associateArtifactsInternalMock.mockResolvedValue(2);
        associateImagesInternalMock.mockResolvedValue(3);

        const result = await associateUploadsHandler(
            { artifactIds: [ARTIFACT_ID], imageFileIds: [IMAGE_ID], chatId: CHAT_ID },
            makeCtx(),
        );

        expect(result).toEqual({ associatedArtifacts: 2, associatedImages: 3 });
        expect(associateArtifactsInternalMock).toHaveBeenCalledOnce();
        expect(associateImagesInternalMock).toHaveBeenCalledOnce();
    });

    it('skips the images pipeline entirely when chatId is absent (project-only scope)', async () => {
        associateArtifactsInternalMock.mockResolvedValue(1);

        const result = await associateUploadsHandler(
            { artifactIds: [ARTIFACT_ID], imageFileIds: [IMAGE_ID], projectId: PROJECT_ID },
            makeCtx(),
        );

        expect(result).toEqual({ associatedArtifacts: 1, associatedImages: 0 });
        expect(associateImagesInternalMock).not.toHaveBeenCalled();
    });

    it('throws 502 when only images fail — partial success must not look like 2xx', async () => {
        // The client checks response.ok; if we returned 200 here the failed image associations
        // would silently disappear and the user's message would send anyway. Fail loud.
        associateArtifactsInternalMock.mockResolvedValue(2);
        associateImagesInternalMock.mockRejectedValue(new Error('r2 down'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await associateUploadsHandler(
                { artifactIds: [ARTIFACT_ID], imageFileIds: [IMAGE_ID], chatId: CHAT_ID },
                makeCtx(),
            );
            expect.fail('expected PublicError');
        } catch (err) {
            expect(err).toBeInstanceOf(PublicError);
            const pe = err as PublicError;
            expect(pe.code).toBe('ASSOCIATE_FAILED');
            expect(pe.statusCode).toBe(502);
            // Partial-success counts must be preserved in details for observability.
            expect((pe as any).details).toMatchObject({
                errors: [{ domain: 'images', message: 'r2 down' }],
                associatedArtifacts: 2,
                associatedImages: 0,
            });
        }
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('throws 502 when only artifacts fail', async () => {
        associateArtifactsInternalMock.mockRejectedValue(new Error('db timeout'));
        associateImagesInternalMock.mockResolvedValue(1);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await associateUploadsHandler(
                { artifactIds: [ARTIFACT_ID], imageFileIds: [IMAGE_ID], chatId: CHAT_ID },
                makeCtx(),
            );
            expect.fail('expected PublicError');
        } catch (err) {
            expect(err).toBeInstanceOf(PublicError);
            const pe = err as PublicError;
            expect(pe.code).toBe('ASSOCIATE_FAILED');
            expect(pe.statusCode).toBe(502);
            expect((pe as any).details).toMatchObject({
                errors: [{ domain: 'artifacts', message: 'db timeout' }],
                associatedArtifacts: 0,
                associatedImages: 1,
            });
        }
        consoleError.mockRestore();
    });

    it('throws 500 when both pipelines fail', async () => {
        associateArtifactsInternalMock.mockRejectedValue(new Error('artifact boom'));
        associateImagesInternalMock.mockRejectedValue(new Error('image boom'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await associateUploadsHandler(
                { artifactIds: [ARTIFACT_ID], imageFileIds: [IMAGE_ID], chatId: CHAT_ID },
                makeCtx(),
            );
            expect.fail('expected PublicError');
        } catch (err) {
            expect(err).toBeInstanceOf(PublicError);
            expect((err as PublicError).code).toBe('ASSOCIATE_FAILED');
            expect((err as PublicError).statusCode).toBe(500);
        }
        consoleError.mockRestore();
    });
});
