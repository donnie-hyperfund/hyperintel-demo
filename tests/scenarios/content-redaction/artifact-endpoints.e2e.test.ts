/**
 * Artifact endpoints: content redaction depends on is_internal.
 *
 * - is_internal=true  (default) -> content stripped
 * - is_internal=false (client deliverable) -> content exposed
 *
 * Calls route handlers directly with mocked Clerk auth + real DB.
 */

import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { mockClerkNextjs, setMockClerkUser } from '@/tests/helpers/clerk-mock';
import { clearDatabase, closeTestOrm, getTestEm } from '@/tests/helpers/db';

mockClerkNextjs();

const SECRET = '# SECRET BODY that must never reach the frontend.';
const PUBLIC_CONTENT = '# PUBLIC deliverable visible to users.';
const CLERK_ID = 'user_artifact_test';

let projectId: string;
let chatId: string;

// Internal artifact (is_internal=true, default)
let internalArtifactId: string;
let internalArtifactKey: string;

// Non-internal artifact (is_internal=false, client deliverable)
let publicArtifactId: string;
let publicArtifactKey: string;

beforeAll(async () => {
    const em = await getTestEm();
    const user = em.create(UserEntity, { email: 'artifact-test@t.com', emailConfirmed: true, clerkId: CLERK_ID });
    const project = em.create(ProjectEntity, { name: 'P', user });
    const chat = em.create(ChatEntity, { phase: 'chat', phase_index: 0, project });

    // Internal artifact — content must be redacted
    const internalArtifact = em.create(ArtifactEntity, {
        key: 'secret-doc.md',
        version: 2,
        project,
        current_version: null!,
    });
    const iv1 = em.create(ArtifactVersionEntity, {
        artifact: internalArtifact,
        version: 1,
        title: 'Secret',
        content: SECRET,
        status: 'approved',
        chat,
    });
    const iv2 = em.create(ArtifactVersionEntity, {
        artifact: internalArtifact,
        version: 2,
        title: 'Secret',
        content: SECRET + '\nv2',
        status: 'proposed',
        chat,
    });
    internalArtifact.current_version = iv1;

    // Non-internal artifact — content must be exposed
    const publicArtifact = em.create(ArtifactEntity, {
        key: 'deliverable.md',
        version: 2,
        project,
        current_version: null!,
    });
    const pv1 = em.create(ArtifactVersionEntity, {
        artifact: publicArtifact,
        version: 1,
        title: 'Deliverable',
        content: PUBLIC_CONTENT,
        status: 'approved',
        is_internal: false,
        chat,
    });
    const pv2 = em.create(ArtifactVersionEntity, {
        artifact: publicArtifact,
        version: 2,
        title: 'Deliverable',
        content: PUBLIC_CONTENT + '\nv2',
        status: 'proposed',
        is_internal: false,
        chat,
    });
    publicArtifact.current_version = pv1;

    await em.persistAndFlush([user, project, chat, internalArtifact, iv1, iv2, publicArtifact, pv1, pv2]);
    projectId = project.id;
    chatId = chat.id;
    internalArtifactId = internalArtifact.id;
    internalArtifactKey = internalArtifact.key;
    publicArtifactId = publicArtifact.id;
    publicArtifactKey = publicArtifact.key;
});

beforeEach(() => {
    setMockClerkUser({ userId: CLERK_ID });
});

afterAll(async () => {
    await clearDatabase();
    await closeTestOrm();
});

function req(url: string) {
    return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('internal artifact content redaction (is_internal=true)', () => {
    it('GET /projects/:pid/artifacts — no content in list', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/route');
        const res = await GET(req(`/api/projects/${projectId}/artifacts`), { params: Promise.resolve({ projectId }) });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).not.toContain(SECRET);
    });

    it('GET /projects/:pid/artifacts?key=... — no content by key', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/route');
        const res = await GET(req(`/api/projects/${projectId}/artifacts?key=${internalArtifactKey}`), {
            params: Promise.resolve({ projectId }),
        });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).not.toContain(SECRET);
    });

    it('GET /projects/:pid/artifacts/:aid — no content on single', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/[artifactId]/route');
        const res = await GET(req(`/api/projects/${projectId}/artifacts/${internalArtifactId}`), {
            params: Promise.resolve({ projectId, artifactId: internalArtifactId }),
        });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).not.toContain(SECRET);
    });

    it('GET /projects/:pid/artifacts/:aid?version=1 — no content on loaded version', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/[artifactId]/route');
        const res = await GET(req(`/api/projects/${projectId}/artifacts/${internalArtifactId}?version=1`), {
            params: Promise.resolve({ projectId, artifactId: internalArtifactId }),
        });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).not.toContain(SECRET);
    });

    it('GET /chats/:cid/artifacts — no content in list', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/chats/[chatId]/artifacts/route');
        const res = await GET(req(`/api/projects/${projectId}/chats/${chatId}/artifacts`), {
            params: Promise.resolve({ projectId, chatId }),
        });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).not.toContain(SECRET);
    });

    it('GET /chats/:cid/artifacts/:aid — no content on single chat artifact', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/chats/[chatId]/artifacts/[artifactId]/route');
        const res = await GET(req(`/api/projects/${projectId}/chats/${chatId}/artifacts/${internalArtifactId}`), {
            params: Promise.resolve({ projectId, chatId, artifactId: internalArtifactId }),
        });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).not.toContain(SECRET);
    });
});

describe('non-internal artifact content exposure (is_internal=false)', () => {
    it('GET /projects/:pid/artifacts — public content in list', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/route');
        const res = await GET(req(`/api/projects/${projectId}/artifacts`), { params: Promise.resolve({ projectId }) });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).toContain(PUBLIC_CONTENT);
    });

    it('GET /projects/:pid/artifacts?key=... — public content by key', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/route');
        const res = await GET(req(`/api/projects/${projectId}/artifacts?key=${publicArtifactKey}`), {
            params: Promise.resolve({ projectId }),
        });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).toContain(PUBLIC_CONTENT);
    });

    it('GET /projects/:pid/artifacts/:aid — public content on single', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/[artifactId]/route');
        const res = await GET(req(`/api/projects/${projectId}/artifacts/${publicArtifactId}`), {
            params: Promise.resolve({ projectId, artifactId: publicArtifactId }),
        });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).toContain(PUBLIC_CONTENT);
    });

    it('GET /projects/:pid/artifacts/:aid?version=1 — public content on loaded version', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/[artifactId]/route');
        const res = await GET(req(`/api/projects/${projectId}/artifacts/${publicArtifactId}?version=1`), {
            params: Promise.resolve({ projectId, artifactId: publicArtifactId }),
        });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).toContain(PUBLIC_CONTENT);
    });

    it('GET /chats/:cid/artifacts — public content in list', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/chats/[chatId]/artifacts/route');
        const res = await GET(req(`/api/projects/${projectId}/chats/${chatId}/artifacts`), {
            params: Promise.resolve({ projectId, chatId }),
        });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).toContain(PUBLIC_CONTENT);
    });

    it('GET /chats/:cid/artifacts/:aid — public content on single chat artifact', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/chats/[chatId]/artifacts/[artifactId]/route');
        const res = await GET(req(`/api/projects/${projectId}/chats/${chatId}/artifacts/${publicArtifactId}`), {
            params: Promise.resolve({ projectId, chatId, artifactId: publicArtifactId }),
        });
        const json = await res.text();
        expect(res.status).toBe(200);
        expect(json).toContain(PUBLIC_CONTENT);
    });
});
