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
import { associateArtifactsInternal, confirmUploadHandler, presignUploadHandler } from './artifact-uploader';

function makeEntityManager() {
    return {
        find: vi.fn().mockResolvedValue([]),
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

// ---------------------------------------------------------------------------
// confirmUploadHandler — extraction must be deferred for staged uploads
// ---------------------------------------------------------------------------

describe('confirmUploadHandler', () => {
    const VERSION_ID = '55555555-5555-5555-5555-555555555555';
    const FILE_ID = '66666666-6666-6666-6666-666666666666';
    const ARTIFACT_ID = '77777777-7777-7777-7777-777777777777';
    const PROJECT_ID = '88888888-8888-8888-8888-888888888888';

    function makeConfirmCtx({ project, chat }: { project?: { id: string }; chat?: { id: string } }) {
        const queueSend = vi.fn(async () => {});
        const headCalls: string[] = [];

        const em = {
            findOneOrFail: vi.fn(async (entity: unknown) => {
                if (entity === ArtifactFileEntity) {
                    return {
                        id: FILE_ID,
                        storage_key: 'uploads/staged/user-1/v1/file.pdf',
                        original_name: 'file.pdf',
                        mime_type: 'application/pdf',
                        size_bytes: 1024,
                        status: 'pending_upload',
                    };
                }
                if (entity === ArtifactVersionEntity) {
                    return {
                        id: VERSION_ID,
                        version: 1,
                        artifact: { id: ARTIFACT_ID, project, chat, key: 'file.pdf' },
                    };
                }
                throw new Error('Unexpected entity');
            }),
            flush: vi.fn(),
        };

        const ctx = {
            em,
            user: { userId: 'clerk-user-1' },
            env: {
                ARTIFACTS_BUCKET: {
                    head: vi.fn(async (key: string) => {
                        headCalls.push(key);
                        return { size: 1024 };
                    }),
                },
                EXTRACTION_QUEUE: { send: queueSend },
            },
            previewAlias: null,
        } as any;

        return { ctx, queueSend, em };
    }

    beforeEach(() => vi.clearAllMocks());

    it('does NOT queue extraction when the artifact is staged (no project, no chat)', async () => {
        const { ctx, queueSend } = makeConfirmCtx({});

        await confirmUploadHandler({ fileId: FILE_ID, versionId: VERSION_ID }, ctx);

        expect(queueSend).not.toHaveBeenCalled();
    });

    it('queues extraction when the artifact has a project scope', async () => {
        const { ctx, queueSend } = makeConfirmCtx({ project: { id: PROJECT_ID } });

        await confirmUploadHandler({ fileId: FILE_ID, versionId: VERSION_ID }, ctx);

        expect(queueSend).toHaveBeenCalledOnce();
        const payload = queueSend.mock.calls[0][0];
        expect(payload.type).toBe('extract_file_content');
        expect(payload.projectId).toBe(PROJECT_ID);
        expect(payload.chatId).toBeNull();
        expect(payload.artifactId).toBe(ARTIFACT_ID);
        expect(payload.versionId).toBe(VERSION_ID);
    });
});

// ---------------------------------------------------------------------------
// associateArtifactsInternal — must resume deferred extraction with real scope
// ---------------------------------------------------------------------------

describe('associateArtifactsInternal', () => {
    const DB_USER_ID = 'db-user-1';
    const CHAT_ID = '99999999-9999-9999-9999-999999999999';
    const ARTIFACT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const VERSION_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const FILE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    function makeVersion(overrides: Partial<any> = {}) {
        return {
            id: VERSION_ID,
            status: 'approved',
            content: null as string | null,
            ...overrides,
        };
    }

    function makeArtifact(version: any) {
        const a = {
            id: ARTIFACT_ID,
            key: 'doc.pdf',
            project: null,
            chat: null,
            user: null,
            metadata: { stagedBy: DB_USER_ID },
            current_version: version,
            versions: { getItems: () => [version] },
        };
        return a;
    }

    function makePendingFile(artifact: any, version: any) {
        return {
            id: FILE_ID,
            storage_key: 'uploads/staged/user-1/v1/doc.pdf',
            original_name: 'doc.pdf',
            mime_type: 'application/pdf',
            status: 'uploaded',
            extracted_content: null,
            artifact_version: { id: version.id, artifact },
        };
    }

    beforeEach(() => vi.clearAllMocks());

    it('queues extraction for pending files using the newly-resolved scope', async () => {
        const version = makeVersion({ content: null });
        const artifact = makeArtifact(version);
        const pendingFile = makePendingFile(artifact, version);

        const queueSend = vi.fn(async () => {});
        const emEmbedSend = vi.fn(async () => {});

        const em = {
            find: vi.fn(async (entity: unknown, filter: any) => {
                // The rename-on-collision check is keyed by $like; return empty so no rename happens
                if (entity === ArtifactEntity && filter?.key?.$like) return [];
                if (entity === ArtifactEntity) return [artifact];
                if (entity === ArtifactFileEntity) return [pendingFile];
                return [];
            }),
            flush: vi.fn(),
            getReference: vi.fn((_entity: string, id: string) => ({ id })),
        };

        const ctx = {
            em,
            env: {
                EXTRACTION_QUEUE: { send: queueSend },
                EMBEDDING_QUEUE: { send: emEmbedSend },
            },
            previewAlias: null,
        } as any;

        const n = await associateArtifactsInternal(ctx, DB_USER_ID, { chatId: CHAT_ID }, [ARTIFACT_ID]);

        expect(n).toBe(1);
        // Scope FK must be applied
        expect(artifact.chat).toEqual({ id: CHAT_ID });
        expect(artifact.user).toEqual({ id: DB_USER_ID });
        expect(artifact.metadata).toBeNull();

        // Extraction requeued with real chatId; no embedding yet (extraction will trigger it)
        expect(queueSend).toHaveBeenCalledOnce();
        expect(queueSend.mock.calls[0][0]).toMatchObject({
            type: 'extract_file_content',
            chatId: CHAT_ID,
            projectId: null,
            artifactId: ARTIFACT_ID,
            versionId: VERSION_ID,
        });
        expect(emEmbedSend).not.toHaveBeenCalled();
    });

    it('queues embedding for versions whose content already exists (text upload path)', async () => {
        const version = makeVersion({ content: 'hello world' });
        const artifact = makeArtifact(version);

        const queueSend = vi.fn(async () => {});
        const emEmbedSend = vi.fn(async () => {});

        const em = {
            find: vi.fn(async (entity: unknown, filter: any) => {
                if (entity === ArtifactEntity && filter?.key?.$like) return [];
                if (entity === ArtifactEntity) return [artifact];
                if (entity === ArtifactFileEntity) return []; // no pending extraction
                return [];
            }),
            flush: vi.fn(),
            getReference: vi.fn((_entity: string, id: string) => ({ id })),
        };

        const ctx = {
            em,
            env: {
                EXTRACTION_QUEUE: { send: queueSend },
                EMBEDDING_QUEUE: { send: emEmbedSend },
            },
            previewAlias: null,
        } as any;

        const n = await associateArtifactsInternal(ctx, DB_USER_ID, { chatId: CHAT_ID }, [ARTIFACT_ID]);

        expect(n).toBe(1);
        expect(queueSend).not.toHaveBeenCalled();
        expect(emEmbedSend).toHaveBeenCalledOnce();
        expect(emEmbedSend.mock.calls[0][0]).toMatchObject({
            type: 'index_artifact_version',
            versionId: VERSION_ID,
            chatId: CHAT_ID,
            content: 'hello world',
        });
    });

    it('does not double-queue embedding for versions awaiting extraction', async () => {
        // Edge case: a version has stale content AND a pending file. Extraction will rewrite
        // content + queue embedding itself — we must not preempt it here.
        const version = makeVersion({ content: 'stale content' });
        const artifact = makeArtifact(version);
        const pendingFile = makePendingFile(artifact, version);

        const queueSend = vi.fn(async () => {});
        const emEmbedSend = vi.fn(async () => {});

        const em = {
            find: vi.fn(async (entity: unknown, filter: any) => {
                if (entity === ArtifactEntity && filter?.key?.$like) return [];
                if (entity === ArtifactEntity) return [artifact];
                if (entity === ArtifactFileEntity) return [pendingFile];
                return [];
            }),
            flush: vi.fn(),
            getReference: vi.fn((_entity: string, id: string) => ({ id })),
        };

        const ctx = {
            em,
            env: {
                EXTRACTION_QUEUE: { send: queueSend },
                EMBEDDING_QUEUE: { send: emEmbedSend },
            },
            previewAlias: null,
        } as any;

        await associateArtifactsInternal(ctx, DB_USER_ID, { chatId: CHAT_ID }, [ARTIFACT_ID]);

        expect(queueSend).toHaveBeenCalledOnce();
        expect(emEmbedSend).not.toHaveBeenCalled();
    });

    it('returns 0 when no staged artifacts match (idempotent on retries)', async () => {
        const em = {
            find: vi.fn(async () => []),
            flush: vi.fn(),
            getReference: vi.fn(),
        };
        const ctx = {
            em,
            env: { EXTRACTION_QUEUE: { send: vi.fn() }, EMBEDDING_QUEUE: { send: vi.fn() } },
            previewAlias: null,
        } as any;

        const n = await associateArtifactsInternal(ctx, DB_USER_ID, { chatId: CHAT_ID }, [ARTIFACT_ID]);
        expect(n).toBe(0);
    });
});
