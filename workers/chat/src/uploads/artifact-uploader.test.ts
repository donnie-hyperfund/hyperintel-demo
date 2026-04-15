import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicError } from '@common/common/error.helpers';

vi.mock('@/lib/env', () => ({
    frontendEnv: {
        NEXT_PUBLIC_LOCAL_WORKERS: true,
        NEXT_PUBLIC_CLOUDFLARE_BASE: '',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_mock',
    },
}));

vi.mock('@/lib/api/requests/worker/common', () => ({
    getWorkerUrl: vi.fn(() => 'https://worker.example/mock'),
}));

vi.mock('@/lib/vendor/r2', () => ({
    createWorkerS3Client: vi.fn(async () => ({ stub: true })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.fn(async () => 'https://signed.example/upload'),
}));

vi.mock('../utils/broadcast', () => ({
    broadcastUserEvent: vi.fn(),
}));

import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { presignUploadHandler } from './artifact-uploader';

function makeEntityManager() {
    return {
        findOne: vi.fn().mockResolvedValue(null),
        findOneOrFail: vi.fn(async (entity: unknown) => {
            if (entity === ProjectEntity) {
                return { id: 'project-entity', user: { id: 'db-user-1' } };
            }
            if (entity === UserEntity) {
                return { id: 'db-user-1' };
            }
            return { id: 'db-user-1', user: { id: 'db-user-1' } };
        }),
        getReference: vi.fn((_entity: string, id: string) => ({ id })),
        persist: vi.fn((entity: unknown) => {
            if (entity instanceof ArtifactEntity && !entity.id) entity.id = 'artifact-1';
            if (entity instanceof ArtifactVersionEntity && !entity.id) entity.id = 'version-1';
            if (entity instanceof ArtifactFileEntity && !entity.id) entity.id = 'file-1';
        }),
        flush: vi.fn(),
        transactional: vi.fn(async (callback: (em: any) => Promise<void>) => {
            const txEm = makeEntityManager();
            txEm.findOne = vi.fn().mockResolvedValue(null);
            txEm.findOneOrFail = vi.fn();
            txEm.getReference = vi.fn((_entity: string, id: string) => ({ id }));
            txEm.persist = vi.fn((entity: unknown) => {
                if (entity instanceof ArtifactEntity && !entity.id) entity.id = 'artifact-1';
                if (entity instanceof ArtifactVersionEntity && !entity.id) entity.id = 'version-1';
            });
            txEm.flush = vi.fn();
            await callback(txEm);
        }),
    };
}

describe('presignUploadHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('accepts image uploads in the artifact presign flow', async () => {
        const em = makeEntityManager();
        const ctx = {
            em,
            user: { userId: 'clerk-user-1' },
            env: { ENV: 'test' },
        } as any;

        const result = await presignUploadHandler(
            {
                filename: 'photo.png',
                fileSize: 1024,
                projectId: '11111111-1111-1111-1111-111111111111',
            },
            ctx,
        );

        expect(result.uploadUrl).toBe('https://signed.example/upload');
        expect(result.fileId).toBe('file-1');
        expect(result.key).toBe('photo.png.md');
    });

    it('still rejects unsupported extensions', async () => {
        const em = makeEntityManager();
        const ctx = {
            em,
            user: { userId: 'clerk-user-1' },
            env: { ENV: 'test' },
        } as any;

        await expect(
            presignUploadHandler(
                {
                    filename: 'archive.zip',
                    fileSize: 1024,
                    projectId: '11111111-1111-1111-1111-111111111111',
                },
                ctx,
            ),
        ).rejects.toBeInstanceOf(PublicError);
    });
});
