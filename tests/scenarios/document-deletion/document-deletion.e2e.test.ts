/**
 * Document deletion — e2e tests.
 *
 * Tests the 'deleted' version status across the full stack:
 * - document-service: listDocuments, findDocumentByName, upsertDocument, approveVersion
 * - API endpoints: artifact list, single artifact, chat summary
 * - Edge cases: delete/restore cycles, null current_version, version ordering
 *
 * Uses real DB + mocked Clerk auth, calls route handlers directly.
 */

import { NextRequest } from 'next/server';
import { getTestEm, clearDatabase, closeTestOrm } from '@/tests/helpers/db';
import { mockClerkNextjs, setMockClerkUser } from '@/tests/helpers/clerk-mock';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import {
    findDocumentByName,
    listDocuments,
    reserveDraftVersion,
    upsertDocument,
    approveVersion,
    rejectVersion,
} from '@/workers/chat/src/tools/documents/document-service';
import type { ILockService } from '@/workers/_common/util/locks';

mockClerkNextjs();

const CLERK_ID = 'user_deletion_e2e';
let projectId: string;
let chatId: string;

beforeAll(async () => {
    const em = await getTestEm();
    const user = em.create(UserEntity, { email: 'deletion-e2e@t.com', emailConfirmed: true, clerkId: CLERK_ID });
    const project = em.create(ProjectEntity, { name: 'Deletion E2E', user });
    const chat = em.create(ChatEntity, { phase: 'chat', phase_index: 0, project });
    await em.persistAndFlush([user, project, chat]);
    projectId = project.id;
    chatId = chat.id;
});

beforeEach(() => {
    setMockClerkUser({ userId: CLERK_ID });
});

afterAll(async () => {
    await clearDatabase();
    await closeTestOrm();
});

// -- helpers ------------------------------------------------------------------

function req(url: string) {
    return new NextRequest(new URL(url, 'http://localhost:3000'));
}

const scope = () => ({ projectId });

const testLockService: ILockService = {
    acquire: (lockId, ttl) => {
        const now = Date.now();
        return { lockId, lease: 1, deadline: now + ttl * 1000, lastUsed: now };
    },
    release: () => true,
};

/** Reserve a draft version then upsert — mirrors the production reserve→write flow. */
async function upsertDoc(em: Awaited<ReturnType<typeof getTestEm>>, name: string, title: string, content: string) {
    const reservation = await reserveDraftVersion({
        em,
        lockService: testLockService,
        scope: scope(),
        name,
        mode: 'create',
    });
    if (reservation.kind !== 'reserved') {
        throw new Error(`upsertDoc: unexpected reservation result "${reservation.kind}" for "${name}"`);
    }
    return upsertDocument({
        em,
        lockService: testLockService,
        scope: scope(),
        chatId,
        name,
        title,
        content,
        reservedVersion: reservation.reservedVersion,
    });
}

async function createApprovedArtifact(name: string, content: string, title?: string) {
    const em = await getTestEm();
    const result = await upsertDoc(em, name, title ?? name, content);
    const approveResult = await approveVersion(em, result.versionId);
    if (!approveResult.success) throw new Error('Failed to approve: ' + (approveResult as any).error);
    return result;
}

async function markCurrentVersionDeleted(name: string) {
    const em = await getTestEm();
    const artifact = await em.findOneOrFail(
        ArtifactEntity,
        { project: projectId, key: name },
        { populate: ['current_version'] },
    );
    if (!artifact.current_version) throw new Error('No current_version to delete');
    artifact.current_version.status = 'deleted';
    artifact.current_version.status_changed_at = new Date();
    await em.flush();
}

async function getArtifactId(name: string): Promise<string> {
    const em = await getTestEm();
    const artifact = await em.findOneOrFail(ArtifactEntity, { project: projectId, key: name });
    return artifact.id;
}

// =============================================================================
// DOCUMENT SERVICE
// =============================================================================

describe('listDocuments', () => {
    const DOC = 'svc-list.md';

    beforeAll(async () => {
        await createApprovedArtifact(DOC, '# Visible');
    });

    it('includes approved artifact', async () => {
        const em = await getTestEm();
        const docs = await listDocuments(em, scope());
        expect(docs.some((d) => d.name === DOC)).toBe(true);
    });

    it('excludes deleted artifact', async () => {
        await markCurrentVersionDeleted(DOC);
        const em = await getTestEm();
        const docs = await listDocuments(em, scope());
        expect(docs.some((d) => d.name === DOC)).toBe(false);
    });

    it('excludes artifact with null current_version (never approved)', async () => {
        const em = await getTestEm();
        await upsertDoc(em, 'svc-null-cv.md', 'Null CV', '# Proposed only');
        const docs = await listDocuments(em, scope());
        expect(docs.some((d) => d.name === 'svc-null-cv.md')).toBe(false);
    });
});

describe('findDocumentByName on deleted artifact', () => {
    const DOC = 'svc-find.md';
    const CONTENT = '# Findable even when deleted';

    beforeAll(async () => {
        await createApprovedArtifact(DOC, CONTENT);
        await markCurrentVersionDeleted(DOC);
    });

    it('returns document with deleted status and full content', async () => {
        const em = await getTestEm();
        const doc = await findDocumentByName(em, scope(), DOC);
        expect(doc).not.toBeNull();
        expect(doc!.name).toBe(DOC);
        expect(doc!.currentStatus).toBe('deleted');
        expect(doc!.currentContent).toBe(CONTENT);
        expect(doc!.currentVersion).toBe(1);
    });
});

describe('upsertDocument on deleted artifact', () => {
    const DOC = 'svc-upsert-del.md';

    beforeAll(async () => {
        await createApprovedArtifact(DOC, '# Original');
        await markCurrentVersionDeleted(DOC);
    });

    it('creates proposed v2 on top of deleted artifact', async () => {
        const em = await getTestEm();
        const result = await upsertDoc(em, DOC, DOC, '# New content');
        expect(result.action).toBe('proposed');
        expect(result.version).toBe(2);
    });

    it('approving v2 restores artifact to listDocuments', async () => {
        const em = await getTestEm();
        const artifact = await em.findOneOrFail(
            ArtifactEntity,
            { project: projectId, key: DOC },
            { populate: ['versions'] },
        );
        const v2 = artifact.versions.getItems().find((v) => v.status === 'proposed');
        const result = await approveVersion(em, v2!.id);
        expect(result.success).toBe(true);

        const docs = await listDocuments(em, scope());
        expect(docs.some((d) => d.name === DOC)).toBe(true);
    });
});

describe('approveVersion on deleted version', () => {
    const DOC = 'svc-approve-del.md';

    beforeAll(async () => {
        await createApprovedArtifact(DOC, '# Content');
        await markCurrentVersionDeleted(DOC);
    });

    it('rejects with error mentioning deleted status', async () => {
        const em = await getTestEm();
        const artifact = await em.findOneOrFail(
            ArtifactEntity,
            { project: projectId, key: DOC },
            { populate: ['current_version'] },
        );
        const result = await approveVersion(em, artifact.current_version!.id);
        expect(result.success).toBe(false);
        expect((result as any).error).toContain('deleted');
    });
});

describe('rejectVersion on deleted version', () => {
    const DOC = 'svc-reject-del.md';

    beforeAll(async () => {
        await createApprovedArtifact(DOC, '# Content');
        await markCurrentVersionDeleted(DOC);
    });

    it('rejects with error mentioning deleted status', async () => {
        const em = await getTestEm();
        const artifact = await em.findOneOrFail(
            ArtifactEntity,
            { project: projectId, key: DOC },
            { populate: ['current_version'] },
        );
        const result = await rejectVersion(em, artifact.current_version!.id, 'bad');
        expect(result.success).toBe(false);
        expect((result as any).error).toContain('deleted');
    });
});

describe('delete → restore → delete cycle', () => {
    const DOC = 'svc-cycle.md';

    it('full cycle works correctly', async () => {
        const em = await getTestEm();

        // 1. Create + approve
        await createApprovedArtifact(DOC, '# v1');
        let docs = await listDocuments(em, scope());
        expect(docs.some((d) => d.name === DOC)).toBe(true);

        // 2. Delete
        await markCurrentVersionDeleted(DOC);
        docs = await listDocuments(em, scope());
        expect(docs.some((d) => d.name === DOC)).toBe(false);

        // 3. Restore via upsert + approve
        const restore = await upsertDoc(em, DOC, DOC, '# v2 restored');
        const artifact = await em.findOneOrFail(
            ArtifactEntity,
            { project: projectId, key: DOC },
            { populate: ['versions'] },
        );
        const proposed = artifact.versions.getItems().find((v) => v.version === restore.version);
        await approveVersion(em, proposed!.id);
        docs = await listDocuments(em, scope());
        expect(docs.some((d) => d.name === DOC)).toBe(true);

        // 4. Delete again
        await markCurrentVersionDeleted(DOC);
        docs = await listDocuments(em, scope());
        expect(docs.some((d) => d.name === DOC)).toBe(false);

        // 5. Still findable by name
        const doc = await findDocumentByName(em, scope(), DOC);
        expect(doc).not.toBeNull();
        expect(doc!.currentStatus).toBe('deleted');
    });
});

// =============================================================================
// API ENDPOINTS
// =============================================================================

describe('API: artifact list includes deleted with status', () => {
    const DOC = 'api-list.md';
    let artifactId: string;

    beforeAll(async () => {
        await createApprovedArtifact(DOC, '# API list test');
        artifactId = await getArtifactId(DOC);
        await markCurrentVersionDeleted(DOC);
    });

    it('GET /projects/:pid/artifacts — deleted artifact still in list', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/route');
        const res = await GET(req(`/api/projects/${projectId}/artifacts`), { params: Promise.resolve({ projectId }) });
        expect(res.status).toBe(200);
        const body: any = await res.json();
        const artifact = body.data?.find((a) => a.key === DOC);
        expect(artifact).toBeDefined();
    });

    it('GET /artifacts/:aid — returns deleted artifact', async () => {
        const { GET } = await import('@/app/api/artifacts/[artifactId]/route');
        const res = await GET(req(`/api/artifacts/${artifactId}`), {
            params: Promise.resolve({ artifactId }),
        });
        expect(res.status).toBe(200);
    });

    it('GET /projects/:pid/artifacts?key=... — returns deleted artifact by key', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/route');
        const res = await GET(req(`/api/projects/${projectId}/artifacts?key=${DOC}`), {
            params: Promise.resolve({ projectId }),
        });
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.key).toBe(DOC);
    });
});

describe('API: chat summary reflects deleted artifacts', () => {
    const DOC = 'api-chat-del.md';

    beforeAll(async () => {
        await createApprovedArtifact(DOC, '# Chat doc');
        await markCurrentVersionDeleted(DOC);
    });

    it('GET /chats/:cid — includes deleted artifact in documents with deleted status', async () => {
        const { GET } = await import('@/app/api/chats/[chatId]/route');
        const res = await GET(req(`/api/chats/${chatId}`), {
            params: Promise.resolve({ chatId }),
        });
        expect(res.status).toBe(200);
        const body: any = await res.json();
        const doc = body.documents?.find((d) => d.key === DOC);
        expect(doc).toBeDefined();
        if (!doc) throw new Error('Expected deleted artifact document in chat summary');
        expect(doc.status).toBe('deleted');
    });
});

describe('API: restored artifact appears normally', () => {
    const DOC = 'api-restore.md';

    beforeAll(async () => {
        await createApprovedArtifact(DOC, '# Original');
        await markCurrentVersionDeleted(DOC);
        // Restore
        const em = await getTestEm();
        const result = await upsertDoc(em, DOC, DOC, '# Restored');
        const artifact = await em.findOneOrFail(
            ArtifactEntity,
            { project: projectId, key: DOC },
            { populate: ['versions'] },
        );
        const proposed = artifact.versions.getItems().find((v) => v.version === result.version);
        await approveVersion(em, proposed!.id);
    });

    it('GET /chats/:cid — restored artifact has approved status', async () => {
        const { GET } = await import('@/app/api/chats/[chatId]/route');
        const res = await GET(req(`/api/chats/${chatId}`), {
            params: Promise.resolve({ chatId }),
        });
        expect(res.status).toBe(200);
        const body: any = await res.json();
        const doc = body.documents?.find((d) => d.key === DOC);
        expect(doc).toBeDefined();
        if (!doc) throw new Error('Expected restored artifact document in chat summary');
        expect(doc.status).toBe('approved');
    });
});
