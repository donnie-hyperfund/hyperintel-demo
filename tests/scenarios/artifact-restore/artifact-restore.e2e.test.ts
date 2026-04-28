import { NextRequest } from 'next/server';
import { PublicError } from '@/common/common/error.helpers';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity, type VersionStatus } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { mockClerkNextjs, setMockClerkUser } from '@/tests/helpers/clerk-mock';
import { clearDatabase, closeTestOrm, getTestEm } from '@/tests/helpers/db';
import { restoreArtifactHandler } from '@/workers/chat/src/artifact-restorer';

mockClerkNextjs();

const CLERK_ID = 'user_artifact_restore';
let projectId: string;
let chatId: string;

type VersionSeed = {
    version: number;
    status: VersionStatus;
    content: string;
    isCurrent?: boolean;
    isInternal?: boolean;
    chatId?: string | null;
};

function req(url: string) {
    return new NextRequest(new URL(url, 'http://localhost:3000'));
}

async function createProjectArtifact(key: string, seeds: VersionSeed[]) {
    const em = await getTestEm();
    const project = await em.findOneOrFail(ProjectEntity, { id: projectId }, { populate: ['user'] });

    const artifact = em.create(ArtifactEntity, {
        key,
        title: key,
        version: Math.max(...seeds.map((s) => s.version)),
        project,
    } as any);
    em.persist(artifact);
    await em.flush();

    const versions: ArtifactVersionEntity[] = [];
    for (const seed of seeds) {
        const versionChat =
            seed.chatId === null ? undefined : (em.getReference('ChatEntity', seed.chatId ?? chatId) as any);
        const version = em.create(ArtifactVersionEntity, {
            artifact,
            version: seed.version,
            content: seed.content,
            status: seed.status,
            is_internal: seed.isInternal ?? false,
            document_type: 'Other',
            status_changed_at: new Date(),
            chat: versionChat,
        });
        em.persist(version);
        versions.push(version);
    }
    await em.flush();

    const currentSeed = seeds.find((s) => s.isCurrent);
    if (currentSeed) {
        artifact.current_version = versions.find((v) => v.version === currentSeed.version)!;
        await em.flush();
    }

    const versionByNumber = new Map<number, ArtifactVersionEntity>(versions.map((v) => [v.version, v]));
    return { artifactId: artifact.id, versionByNumber };
}

function makeCtx(em: Awaited<ReturnType<typeof getTestEm>>) {
    return {
        em,
        user: { userId: CLERK_ID },
        env: {},
    } as any;
}

beforeAll(async () => {
    const em = await getTestEm();
    const user = em.create(UserEntity, {
        email: 'artifact-restore-e2e@t.com',
        emailConfirmed: true,
        clerkId: CLERK_ID,
    });
    const project = em.create(ProjectEntity, { name: 'Artifact Restore E2E', user });
    const chat = em.create(ChatEntity, { phase: 'chat', project });
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

describe('restoreArtifactHandler', () => {
    it('restores a deleted version as a new approved current version', async () => {
        const { versionByNumber, artifactId } = await createProjectArtifact('restore-deleted.md', [
            { version: 1, status: 'approved', content: '# v1' },
            { version: 2, status: 'deleted', content: '# v2 deleted', isCurrent: true },
        ]);

        const em = await getTestEm();
        const result = await restoreArtifactHandler(
            {
                projectId,
                key: 'restore-deleted.md',
                sourceVersionId: versionByNumber.get(1)!.id,
            },
            makeCtx(em),
        );

        expect(result.success).toBe(true);
        expect(result.sourceVersion).toBe(1);
        expect(result.restoredVersion).toBe(3);
        expect(result.status).toBe('approved');

        const artifact = await em.findOneOrFail(
            ArtifactEntity,
            { id: artifactId },
            { populate: ['current_version', 'versions'] },
        );
        expect(artifact.version).toBe(3);
        expect(artifact.current_version.version).toBe(3);
        expect(artifact.current_version.status).toBe('approved');

        const v3 = artifact.versions.getItems().find((v) => v.version === 3);
        expect(v3).toBeDefined();
        expect(v3?.chat).toBeFalsy();
    });

    it('restoring a proposed version supersedes existing proposed versions', async () => {
        const { versionByNumber, artifactId } = await createProjectArtifact('restore-proposed.md', [
            { version: 1, status: 'approved', content: '# approved current', isCurrent: true },
            { version: 2, status: 'proposed', content: '# proposed candidate' },
            { version: 3, status: 'rejected', content: '# latest rejected' },
        ]);

        const em = await getTestEm();
        const result = await restoreArtifactHandler(
            {
                projectId,
                key: 'restore-proposed.md',
                sourceVersionId: versionByNumber.get(2)!.id,
            },
            makeCtx(em),
        );

        expect(result.restoredVersion).toBe(4);
        expect(result.supersededVersions).toContain(2);

        const artifact = await em.findOneOrFail(
            ArtifactEntity,
            { id: artifactId },
            { populate: ['current_version', 'versions'] },
        );
        const v2 = artifact.versions.getItems().find((v) => v.version === 2);
        expect(v2?.status).toBe('superseded');
        expect(artifact.current_version.version).toBe(4);
        expect(artifact.current_version.status).toBe('approved');
    });

    it('restores rejected, superseded, and older approved versions', async () => {
        const { versionByNumber } = await createProjectArtifact('restore-multi-status.md', [
            { version: 1, status: 'approved', content: '# old approved' },
            { version: 2, status: 'rejected', content: '# rejected source' },
            { version: 3, status: 'superseded', content: '# superseded source' },
            { version: 4, status: 'approved', content: '# current approved', isCurrent: true },
        ]);

        const em = await getTestEm();

        const fromRejected = await restoreArtifactHandler(
            {
                projectId,
                key: 'restore-multi-status.md',
                sourceVersionId: versionByNumber.get(2)!.id,
            },
            makeCtx(em),
        );
        expect(fromRejected.restoredVersion).toBe(5);

        const fromSuperseded = await restoreArtifactHandler(
            {
                projectId,
                key: 'restore-multi-status.md',
                sourceVersionId: versionByNumber.get(3)!.id,
            },
            makeCtx(em),
        );
        expect(fromSuperseded.restoredVersion).toBe(6);

        const fromOlderApproved = await restoreArtifactHandler(
            {
                projectId,
                key: 'restore-multi-status.md',
                sourceVersionId: versionByNumber.get(1)!.id,
            },
            makeCtx(em),
        );
        expect(fromOlderApproved.restoredVersion).toBe(7);
    });

    it('blocks restore when selected version is already active', async () => {
        const { versionByNumber } = await createProjectArtifact('restore-current-blocked.md', [
            { version: 1, status: 'approved', content: '# old approved' },
            { version: 2, status: 'approved', content: '# current', isCurrent: true },
        ]);

        const em = await getTestEm();
        await expect(
            restoreArtifactHandler(
                {
                    projectId,
                    key: 'restore-current-blocked.md',
                    sourceVersionId: versionByNumber.get(2)!.id,
                },
                makeCtx(em),
            ),
        ).rejects.toMatchObject<Partial<PublicError>>({
            code: 'ALREADY_ACTIVE_VERSION',
            statusCode: 400,
        });
    });

    it('blocks restore when latest version is proposed (approve/reject instead)', async () => {
        const { versionByNumber } = await createProjectArtifact('restore-latest-proposed-blocked.md', [
            { version: 1, status: 'approved', content: '# current approved', isCurrent: true },
            { version: 2, status: 'proposed', content: '# latest proposed' },
        ]);

        const em = await getTestEm();
        await expect(
            restoreArtifactHandler(
                {
                    projectId,
                    key: 'restore-latest-proposed-blocked.md',
                    sourceVersionId: versionByNumber.get(2)!.id,
                },
                makeCtx(em),
            ),
        ).rejects.toMatchObject<Partial<PublicError>>({
            code: 'ALREADY_LATEST_VERSION',
            statusCode: 400,
        });
    });

    it('allows restore when latest version is rejected (terminal state)', async () => {
        // isCurrent on v2 matches real behavior: rejectArtifactHandler sets current_version to the rejected version.
        const { versionByNumber, artifactId } = await createProjectArtifact('restore-latest-rejected.md', [
            { version: 1, status: 'approved', content: '# current approved' },
            { version: 2, status: 'rejected', content: '# latest rejected', isCurrent: true },
        ]);

        const em = await getTestEm();
        const result = await restoreArtifactHandler(
            {
                projectId,
                key: 'restore-latest-rejected.md',
                sourceVersionId: versionByNumber.get(2)!.id,
            },
            makeCtx(em),
        );

        expect(result.success).toBe(true);
        expect(result.sourceVersion).toBe(2);
        expect(result.restoredVersion).toBe(3);
        expect(result.status).toBe('approved');

        const artifact = await em.findOneOrFail(ArtifactEntity, { id: artifactId }, { populate: ['current_version'] });
        expect(artifact.version).toBe(3);
        expect(artifact.current_version.version).toBe(3);
        expect(artifact.current_version.status).toBe('approved');
    });

    it('allows restore of rejected current_version (not blocked by ALREADY_ACTIVE_VERSION)', async () => {
        // After rejection, current_version points to the rejected version.
        // ALREADY_ACTIVE_VERSION should only block approved versions, not rejected ones.
        const { versionByNumber, artifactId } = await createProjectArtifact('restore-rejected-current.md', [
            { version: 1, status: 'approved', content: '# old approved' },
            { version: 2, status: 'rejected', content: '# rejected but is current_version', isCurrent: true },
            { version: 3, status: 'superseded', content: '# superseded' },
        ]);

        const em = await getTestEm();
        const result = await restoreArtifactHandler(
            {
                projectId,
                key: 'restore-rejected-current.md',
                sourceVersionId: versionByNumber.get(2)!.id,
            },
            makeCtx(em),
        );

        expect(result.success).toBe(true);
        expect(result.sourceVersion).toBe(2);
        expect(result.restoredVersion).toBe(4);
        expect(result.status).toBe('approved');

        const artifact = await em.findOneOrFail(ArtifactEntity, { id: artifactId }, { populate: ['current_version'] });
        expect(artifact.current_version.version).toBe(4);
        expect(artifact.current_version.status).toBe('approved');
    });

    it('allows restore when latest version is deleted (terminal state)', async () => {
        const { versionByNumber, artifactId } = await createProjectArtifact('restore-latest-deleted.md', [
            { version: 1, status: 'approved', content: '# v1 content' },
            { version: 2, status: 'deleted', content: '# latest deleted', isCurrent: true },
        ]);

        const em = await getTestEm();
        const result = await restoreArtifactHandler(
            {
                projectId,
                key: 'restore-latest-deleted.md',
                sourceVersionId: versionByNumber.get(2)!.id,
            },
            makeCtx(em),
        );

        expect(result.success).toBe(true);
        expect(result.restoredVersion).toBe(3);

        const artifact = await em.findOneOrFail(ArtifactEntity, { id: artifactId }, { populate: ['current_version'] });
        expect(artifact.current_version.version).toBe(3);
    });
});


describe('version history API', () => {
    it('lists versions in descending order and preserves internal redaction', async () => {
        const secretContent = '# INTERNAL SECRET CONTENT';
        await createProjectArtifact('history-api.md', [
            { version: 1, status: 'approved', content: secretContent, isCurrent: true, isInternal: true },
            { version: 2, status: 'rejected', content: `${secretContent}\nv2`, isInternal: true },
            { version: 3, status: 'superseded', content: `${secretContent}\nv3`, isInternal: true },
        ]);

        const { GET } = await import('@/app/api/projects/[projectId]/artifacts/versions/route');
        const response = await GET(req(`/api/projects/${projectId}/artifacts/versions?key=history-api.md`), {
            params: Promise.resolve({ projectId }),
        });

        expect(response.status).toBe(200);

        const rawText = await response.text();
        expect(rawText).not.toContain(secretContent);

        const body = JSON.parse(rawText);
        expect(body.artifact.key).toBe('history-api.md');
        expect(body.versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
        expect(body.versions[0].status).toBe('superseded');
        expect(body.versions[1].status).toBe('rejected');
        expect(body.versions[2].status).toBe('approved');
    });
});
