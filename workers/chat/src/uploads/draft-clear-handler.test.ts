import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
    frontendEnv: {
        NEXT_PUBLIC_LOCAL_WORKERS: true,
        NEXT_PUBLIC_CLOUDFLARE_BASE: '',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_mock',
    },
}));

import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { clearDraftsHandler } from './draft-clear-handler';

const DB_USER_ID = 'db-user-1';
const ARTIFACT_A = '11111111-1111-1111-1111-111111111111';
const ARTIFACT_B = '22222222-2222-2222-2222-222222222222';

function makeArtifact(overrides: Partial<ArtifactEntity> & { is_draft: boolean }): ArtifactEntity {
    return { id: ARTIFACT_A, ...overrides } as unknown as ArtifactEntity;
}

function makeCtx(drafts: ArtifactEntity[]) {
    const whereMock = vi.fn().mockReturnThis();
    const qb = {
        select: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: whereMock,
        getResultList: vi.fn().mockResolvedValue(drafts),
    };
    const em = {
        createQueryBuilder: vi.fn().mockReturnValue(qb),
        findOneOrFail: vi.fn(async (entity: unknown) => {
            if (entity === UserEntity) return { id: DB_USER_ID };
            throw new Error('Unexpected entity');
        }),
        flush: vi.fn(),
    };
    return { em, qb, whereMock, ctx: { em, user: { userId: 'clerk-user-1' } } as any };
}

describe('clearDraftsHandler', () => {
    beforeEach(() => vi.clearAllMocks());

    it('flips is_draft=false for matching drafts', async () => {
        const artifactA = makeArtifact({ is_draft: true });
        const artifactB = makeArtifact({ id: ARTIFACT_B, is_draft: true });
        const { ctx, em } = makeCtx([artifactA, artifactB]);

        const result = await clearDraftsHandler({ artifactIds: [ARTIFACT_A, ARTIFACT_B] }, ctx);

        expect(result.clearedDrafts).toBe(2);
        expect(artifactA.is_draft).toBe(false);
        expect(artifactB.is_draft).toBe(false);
        expect(em.flush).toHaveBeenCalledOnce();
    });

    it('joins project + chat and $ors across every ownership path used in the codebase', async () => {
        const { ctx, qb, whereMock } = makeCtx([]);

        await clearDraftsHandler({ artifactIds: [ARTIFACT_A] }, ctx);

        // Joins project and chat so the where-clause can traverse ownership via either.
        expect(qb.leftJoin).toHaveBeenCalledWith('a.project', 'p');
        expect(qb.leftJoin).toHaveBeenCalledWith('a.chat', 'c');

        const filter = whereMock.mock.calls[0][0];
        expect(filter).toMatchObject({
            'a.id': { $in: [ARTIFACT_A] },
            'a.is_draft': true,
        });
        // All four ownership paths — direct user, staged metadata, project.user, chat.user.
        expect(filter.$or).toHaveLength(4);
        expect(filter.$or).toEqual(
            expect.arrayContaining([{ 'a.user': DB_USER_ID }, { 'p.user': DB_USER_ID }, { 'c.user': DB_USER_ID }]),
        );
    });

    it('is a no-op when no drafts match — never flushes', async () => {
        const { ctx, em } = makeCtx([]);

        const result = await clearDraftsHandler({ artifactIds: [ARTIFACT_A] }, ctx);

        expect(result.clearedDrafts).toBe(0);
        expect(em.flush).not.toHaveBeenCalled();
    });
});
