import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { callRoute } from '@/tests/helpers/api';
import { mockClerkNextjs, setMockClerkUser } from '@/tests/helpers/clerk-mock';
import { clearDatabase, closeTestOrm, getTestEm } from '@/tests/helpers/db';

mockClerkNextjs();

const CLERK_ID_A = 'user_projects_a';
const CLERK_ID_B = 'user_projects_b';

beforeAll(async () => {
    const em = await getTestEm();
    const userA = em.create(UserEntity, { email: 'projects-a@t.com', emailConfirmed: true, clerkId: CLERK_ID_A });
    const userB = em.create(UserEntity, { email: 'projects-b@t.com', emailConfirmed: true, clerkId: CLERK_ID_B });
    await em.persistAndFlush([userA, userB]);
});

beforeEach(() => setMockClerkUser({ userId: CLERK_ID_A }));

afterAll(async () => {
    await clearDatabase();
    await closeTestOrm();
});

describe('projects CRUD', () => {
    let projectId: string;

    it('POST /api/projects — creates a project', async () => {
        const { POST } = await import('@/app/api/projects/route');
        const { status, body } = await callRoute(
            POST,
            '/api/projects',
            {},
            {
                method: 'POST',
                body: { name: 'Test Project', description: 'desc' },
            },
        );
        expect(status).toBe(201);
        expect(body.name).toBe('Test Project');
        expect(body.description).toBe('desc');
        expect(body.id).toBeDefined();
        projectId = body.id;
    });

    it('GET /api/projects — lists projects', async () => {
        const { GET } = await import('@/app/api/projects/route');
        const { status, body } = await callRoute(GET, '/api/projects');
        expect(status).toBe(200);
        expect(body.data.length).toBeGreaterThanOrEqual(1);
        expect(body.data.some((p: any) => p.id === projectId)).toBe(true);
        expect(body.pagination).toBeDefined();
    });

    it('GET /api/projects/:id — gets a project', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/route');
        const { status, body } = await callRoute(GET, `/api/projects/${projectId}`, { projectId });
        expect(status).toBe(200);
        expect(body.id).toBe(projectId);
        expect(body.name).toBe('Test Project');
    });

    it('PATCH /api/projects/:id — updates a project', async () => {
        const { PATCH } = await import('@/app/api/projects/[projectId]/route');
        const { status, body } = await callRoute(
            PATCH,
            `/api/projects/${projectId}`,
            { projectId },
            {
                method: 'PATCH',
                body: { name: 'Updated' },
            },
        );
        expect(status).toBe(200);
        expect(body.name).toBe('Updated');
        expect(body.description).toBe('desc');
    });

    it('DELETE /api/projects/:id — deletes a project', async () => {
        const { DELETE } = await import('@/app/api/projects/[projectId]/route');
        const { status } = await callRoute(DELETE, `/api/projects/${projectId}`, { projectId }, { method: 'DELETE' });
        expect(status).toBe(200);
    });

    it('GET /api/projects/:id — 404 after delete', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/route');
        const { status } = await callRoute(GET, `/api/projects/${projectId}`, { projectId });
        expect(status).toBe(404);
    });
});

describe('projects validation', () => {
    it('POST without name → 400', async () => {
        const { POST } = await import('@/app/api/projects/route');
        const { status } = await callRoute(
            POST,
            '/api/projects',
            {},
            {
                method: 'POST',
                body: { description: 'no name' },
            },
        );
        expect(status).toBe(400);
    });

    it('PATCH with empty name → 400', async () => {
        const { POST } = await import('@/app/api/projects/route');
        const { body: created } = await callRoute(
            POST,
            '/api/projects',
            {},
            {
                method: 'POST',
                body: { name: 'Tmp' },
            },
        );

        const { PATCH } = await import('@/app/api/projects/[projectId]/route');
        const { status } = await callRoute(
            PATCH,
            `/api/projects/${created.id}`,
            { projectId: created.id },
            {
                method: 'PATCH',
                body: { name: '' },
            },
        );
        expect(status).toBe(400);
    });
});

describe('projects ownership', () => {
    let projectIdA: string;

    beforeAll(async () => {
        setMockClerkUser({ userId: CLERK_ID_A });
        const { POST } = await import('@/app/api/projects/route');
        const { body } = await callRoute(
            POST,
            '/api/projects',
            {},
            {
                method: 'POST',
                body: { name: 'UserA Project' },
            },
        );
        projectIdA = body.id;
    });

    it("user B cannot GET user A's project", async () => {
        setMockClerkUser({ userId: CLERK_ID_B });
        const { GET } = await import('@/app/api/projects/[projectId]/route');
        const { status } = await callRoute(GET, `/api/projects/${projectIdA}`, { projectId: projectIdA });
        expect(status).toBe(404);
    });

    it("user B cannot PATCH user A's project", async () => {
        setMockClerkUser({ userId: CLERK_ID_B });
        const { PATCH } = await import('@/app/api/projects/[projectId]/route');
        const { status } = await callRoute(
            PATCH,
            `/api/projects/${projectIdA}`,
            { projectId: projectIdA },
            {
                method: 'PATCH',
                body: { name: 'Hacked' },
            },
        );
        expect(status).toBe(404);
    });

    it("user B cannot DELETE user A's project", async () => {
        setMockClerkUser({ userId: CLERK_ID_B });
        const { DELETE } = await import('@/app/api/projects/[projectId]/route');
        const { status } = await callRoute(
            DELETE,
            `/api/projects/${projectIdA}`,
            { projectId: projectIdA },
            { method: 'DELETE' },
        );
        expect(status).toBe(404);
    });

    it("user B's project list does not include user A's project", async () => {
        setMockClerkUser({ userId: CLERK_ID_B });
        const { GET } = await import('@/app/api/projects/route');
        const { body } = await callRoute(GET, '/api/projects');
        expect(body.data.some((p: any) => p.id === projectIdA)).toBe(false);
    });
});

describe('projects pagination', () => {
    beforeAll(async () => {
        setMockClerkUser({ userId: CLERK_ID_A });
        const { POST } = await import('@/app/api/projects/route');
        for (let i = 0; i < 3; i++) {
            await callRoute(
                POST,
                '/api/projects',
                {},
                {
                    method: 'POST',
                    body: { name: `Paginated ${i}` },
                },
            );
        }
    });

    it('respects limit param', async () => {
        const { GET } = await import('@/app/api/projects/route');
        const { status, body } = await callRoute(GET, '/api/projects?limit=2');
        expect(status).toBe(200);
        expect(body.data.length).toBe(2);
        expect(body.pagination.page).toBe(1);
        expect(body.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });
});

describe('projects archive lifecycle', () => {
    let archivedProjectId: string;

    beforeAll(async () => {
        setMockClerkUser({ userId: CLERK_ID_A });
        const { POST } = await import('@/app/api/projects/route');
        const { body } = await callRoute(
            POST,
            '/api/projects',
            {},
            {
                method: 'POST',
                body: { name: 'Archive Me' },
            },
        );
        archivedProjectId = body.id;
    });

    it('PATCH /api/projects/:id archives a project', async () => {
        const { PATCH } = await import('@/app/api/projects/[projectId]/route');
        const { status, body } = await callRoute(
            PATCH,
            `/api/projects/${archivedProjectId}`,
            { projectId: archivedProjectId },
            {
                method: 'PATCH',
                body: { archived: true },
            },
        );
        expect(status).toBe(200);
        expect(body.archived_at).toBeTruthy();
    });

    it('GET /api/projects excludes archived projects by default', async () => {
        const { GET } = await import('@/app/api/projects/route');
        const { status, body } = await callRoute(GET, '/api/projects');
        expect(status).toBe(200);
        expect(body.data.some((p: any) => p.id === archivedProjectId)).toBe(false);
    });

    it('GET /api/projects?status=archived includes archived projects', async () => {
        const { GET } = await import('@/app/api/projects/route');
        const { status, body } = await callRoute(GET, '/api/projects?status=archived');
        expect(status).toBe(200);
        expect(body.data.some((p: any) => p.id === archivedProjectId)).toBe(true);
    });

    it('GET /api/projects/:id returns 404 while archived', async () => {
        const { GET } = await import('@/app/api/projects/[projectId]/route');
        const { status } = await callRoute(GET, `/api/projects/${archivedProjectId}`, { projectId: archivedProjectId });
        expect(status).toBe(404);
    });

    it('PATCH /api/projects/:id restores an archived project', async () => {
        const { PATCH } = await import('@/app/api/projects/[projectId]/route');
        const { status, body } = await callRoute(
            PATCH,
            `/api/projects/${archivedProjectId}`,
            { projectId: archivedProjectId },
            {
                method: 'PATCH',
                body: { archived: false },
            },
        );
        expect(status).toBe(200);
        expect(body.archived_at).toBeNull();
    });
});

describe('project deletion cascades related records', () => {
    it('DELETE /api/projects/:id removes chats, messages, artifacts, and versions', async () => {
        setMockClerkUser({ userId: CLERK_ID_A });
        const em = await getTestEm();
        const user = await em.findOneOrFail(UserEntity, { clerkId: CLERK_ID_A });
        const project = em.create(ProjectEntity, { name: 'Project With Data', user });
        const chat = em.create(ChatEntity, { phase: 'active', phase_index: 0, project, user });
        const message = em.create(ChatMessageEntity, { role: 'user', content: 'hello', chat });
        const artifact = em.create(ArtifactEntity, { key: 'deck', title: 'Deck', version: 1, project, chat, user });
        const version = em.create(ArtifactVersionEntity, {
            artifact,
            chat,
            chat_message: message,
            version: 1,
            content: '# Deck',
            status: 'approved',
            is_internal: false,
        });
        artifact.current_version = version;
        await em.persistAndFlush([project, chat, message, artifact, version]);

        const { DELETE } = await import('@/app/api/projects/[projectId]/route');
        const { status } = await callRoute(
            DELETE,
            `/api/projects/${project.id}`,
            { projectId: project.id },
            { method: 'DELETE' },
        );
        expect(status).toBe(200);

        const verifyEm = await getTestEm();
        expect(await verifyEm.findOne(ProjectEntity, { id: project.id })).toBeNull();
        expect(await verifyEm.findOne(ChatEntity, { id: chat.id })).toBeNull();
        expect(await verifyEm.findOne(ChatMessageEntity, { id: message.id })).toBeNull();
        expect(await verifyEm.findOne(ArtifactEntity, { id: artifact.id })).toBeNull();
        expect(await verifyEm.findOne(ArtifactVersionEntity, { id: version.id })).toBeNull();
    });
});
