import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ------------------------------------------------------------------

vi.mock('@/lib/env', () => ({
    frontendEnv: {
        NEXT_PUBLIC_LOCAL_WORKERS: true,
        NEXT_PUBLIC_CLOUDFLARE_BASE: '',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_mock',
    },
}));

const initInferredContextMock = vi.fn();
vi.mock('@/workers/_common/context.helpers', () => ({
    initInferredContext: (...args: unknown[]) => initInferredContextMock(...args),
}));

import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { cleanupStaleUploads } from './cleanup';

// ---- Helpers ----------------------------------------------------------------

interface FakeFile {
    id: string;
    storage_key: string;
    status?: string;
    artifact_version?: { id: string; artifact: { id: string; project: unknown; chat: unknown } };
}

interface FakeArtifact {
    id: string;
    versions: { getItems: () => Array<{ id: string }> };
}

function makeEnv() {
    return {
        ARTIFACTS_BUCKET: { delete: vi.fn(async () => {}) },
        USER_IMAGES_BUCKET: { delete: vi.fn(async () => {}) },
    } as any;
}

/** EM that returns predetermined results per entity, records the query used. */
function makeEm(responses: {
    [K in 'artifactFile' | 'artifact' | 'imageFile']?: unknown[];
}) {
    const findCalls: Array<{ entity: unknown; query: unknown; options: unknown }> = [];
    const removed: unknown[] = [];
    const em = {
        find: vi.fn(async (entity: unknown, query: unknown, options: unknown) => {
            findCalls.push({ entity, query, options });
            if (entity === ArtifactFileEntity) {
                // Distinguish the "load files for staged artifacts" call (no $or / no status filter)
                // from the primary sweep. Both return ArtifactFileEntity; differentiate by query.
                const q = query as any;
                if (q?.$or || q?.status) return responses.artifactFile ?? [];
                return responses.imageFile ?? [];
            }
            if (entity === ArtifactEntity) return responses.artifact ?? [];
            if (entity === ChatMessageFileEntity) return responses.imageFile ?? [];
            return [];
        }),
        count: vi.fn(async () => 0),
        remove: vi.fn((e: unknown) => {
            removed.push(e);
        }),
        flush: vi.fn(),
        clear: vi.fn(),
    };
    return { em, findCalls, removed };
}

// ---- Tests ------------------------------------------------------------------

describe('cleanupStaleUploads — processArtifactBatch query shape', () => {
    beforeEach(() => vi.clearAllMocks());

    it('targets pending_upload OR scoped-uploaded past the cutoff', async () => {
        const { em, findCalls } = makeEm({});
        initInferredContextMock.mockResolvedValue({ em });

        await cleanupStaleUploads(makeEnv());

        const artifactFileCall = findCalls.find(
            (c) => c.entity === ArtifactFileEntity && (c.query as any)?.$or,
        );
        expect(artifactFileCall).toBeDefined();
        const q = artifactFileCall!.query as any;
        expect(q.created_at.$lt).toBeInstanceOf(Date);
        // $or[0]: never-confirmed regardless of scope
        expect(q.$or[0]).toEqual({ status: 'pending_upload' });
        // $or[1]: uploaded-and-scoped (stalled extraction)
        expect(q.$or[1].status).toBe('uploaded');
        expect(q.$or[1].artifact_version.artifact.$or).toEqual([
            { project: { $ne: null } },
            { chat: { $ne: null } },
        ]);
    });

    it('removes the artifact when the dead file was its only version (orphan)', async () => {
        const file: FakeFile = {
            id: 'f1',
            storage_key: 'uploads/x.pdf',
            status: 'pending_upload',
            artifact_version: {
                id: 'v1',
                artifact: { id: 'a1', project: null, chat: null },
            },
        };
        const { em, removed } = makeEm({ artifactFile: [file] });
        em.count = vi.fn(async () => 0); // no sibling versions
        initInferredContextMock.mockResolvedValue({ em });
        const env = makeEnv();

        await cleanupStaleUploads(env);

        expect(env.ARTIFACTS_BUCKET.delete).toHaveBeenCalledWith('uploads/x.pdf');
        // file + version + artifact all removed
        expect(removed).toHaveLength(3);
        expect(removed).toContainEqual(file);
        expect(removed).toContainEqual(file.artifact_version);
        expect(removed).toContainEqual(file.artifact_version!.artifact);
    });

    it('keeps the artifact when sibling versions exist', async () => {
        const file: FakeFile = {
            id: 'f1',
            storage_key: 'uploads/x.pdf',
            status: 'pending_upload',
            artifact_version: {
                id: 'v1',
                artifact: { id: 'a1', project: { id: 'p1' }, chat: null },
            },
        };
        const { em, removed } = makeEm({ artifactFile: [file] });
        em.count = vi.fn(async () => 2); // siblings exist
        initInferredContextMock.mockResolvedValue({ em });

        await cleanupStaleUploads(makeEnv());

        // file + version removed; artifact kept
        expect(removed).toHaveLength(2);
        expect(removed).not.toContainEqual(file.artifact_version!.artifact);
    });
});

describe('cleanupStaleUploads — processStaleStagedArtifactsBatch', () => {
    beforeEach(() => vi.clearAllMocks());

    it('targets unscoped artifacts carrying metadata.stagedBy past cutoff', async () => {
        const { em, findCalls } = makeEm({});
        initInferredContextMock.mockResolvedValue({ em });

        await cleanupStaleUploads(makeEnv());

        const artifactCall = findCalls.find((c) => c.entity === ArtifactEntity);
        expect(artifactCall).toBeDefined();
        const q = artifactCall!.query as any;
        expect(q.project).toBeNull();
        expect(q.chat).toBeNull();
        expect(q.user).toBeNull();
        expect(q.created_at.$lt).toBeInstanceOf(Date);
        // The raw() JSON expression lives under a computed key; presence is enough to assert.
        const hasStagedByFilter = Object.values(q).some(
            (v) => v && typeof v === 'object' && '$ne' in (v as any) && (v as any).$ne === null,
        );
        expect(hasStagedByFilter).toBe(true);
    });

    it('removes artifact + versions + files for each stale staged artifact', async () => {
        const artifact: FakeArtifact = {
            id: 'a1',
            versions: { getItems: () => [{ id: 'v1' }, { id: 'v2' }] },
        };
        const file = { id: 'f1', storage_key: 'uploads/staged/u1/v1/doc.pdf' };

        const { em, removed } = makeEm({ artifact: [artifact], imageFile: [file] });
        initInferredContextMock.mockResolvedValue({ em });
        const env = makeEnv();

        await cleanupStaleUploads(env);

        expect(env.ARTIFACTS_BUCKET.delete).toHaveBeenCalledWith('uploads/staged/u1/v1/doc.pdf');
        // 1 file + 2 versions + 1 artifact
        expect(removed).toContainEqual(file);
        expect(removed).toContainEqual(artifact);
        expect(removed.filter((r) => (r as any).id?.startsWith('v'))).toHaveLength(2);
    });
});

describe('cleanupStaleUploads — processImageBatch', () => {
    beforeEach(() => vi.clearAllMocks());

    it('targets pending_upload OR orphaned (chat_id null) image rows', async () => {
        const { em, findCalls } = makeEm({});
        initInferredContextMock.mockResolvedValue({ em });

        await cleanupStaleUploads(makeEnv());

        const imageCall = findCalls.find((c) => c.entity === ChatMessageFileEntity);
        expect(imageCall).toBeDefined();
        const q = imageCall!.query as any;
        expect(q.created_at.$lt).toBeInstanceOf(Date);
        expect(q.$or).toEqual([{ status: 'pending_upload' }, { chat_id: null }]);
    });

    it('deletes matching image files from R2 and DB', async () => {
        const file = { id: 'img1', storage_key: 'chat-images/u1/x.png' };
        const { em, removed } = makeEm({ imageFile: [file] });
        initInferredContextMock.mockResolvedValue({ em });
        const env = makeEnv();

        await cleanupStaleUploads(env);

        expect(env.USER_IMAGES_BUCKET.delete).toHaveBeenCalledWith('chat-images/u1/x.png');
        expect(removed).toContainEqual(file);
    });
});
