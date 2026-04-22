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
    const em = {
        find: vi.fn().mockResolvedValue(drafts),
        findOneOrFail: vi.fn(async (entity: unknown) => {
            if (entity === UserEntity) return { id: DB_USER_ID };
            throw new Error('Unexpected entity');
        }),
        flush: vi.fn(),
    };
    return { em, user: { userId: 'clerk-user-1' } } as any;
}

describe('clearDraftsHandler', () => {
    beforeEach(() => vi.clearAllMocks());

    it('flips is_draft=false for matching drafts', async () => {
        const artifactA = makeArtifact({ is_draft: true });
        const artifactB = makeArtifact({ id: ARTIFACT_B, is_draft: true });
        const ctx = makeCtx([artifactA, artifactB]);

        const result = await clearDraftsHandler({ artifactIds: [ARTIFACT_A, ARTIFACT_B] }, ctx);

        expect(result.clearedDrafts).toBe(2);
        expect(artifactA.is_draft).toBe(false);
        expect(artifactB.is_draft).toBe(false);
        expect(ctx.em.flush).toHaveBeenCalledOnce();
    });

    it('scopes the query to the caller via user_id OR stagedBy', async () => {
        const ctx = makeCtx([]);

        await clearDraftsHandler({ artifactIds: [ARTIFACT_A] }, ctx);

        const filter = ctx.em.find.mock.calls[0][1];
        expect(filter).toMatchObject({
            id: { $in: [ARTIFACT_A] },
            is_draft: true,
        });
        // The $or covers both association shapes: already-scoped (user=dbUserId) and staged (metadata.stagedBy=dbUserId)
        expect(filter.$or).toHaveLength(2);
        expect(filter.$or[0]).toEqual({ user: DB_USER_ID });
    });

    it('is a no-op when no drafts match — never flushes', async () => {
        const ctx = makeCtx([]);

        const result = await clearDraftsHandler({ artifactIds: [ARTIFACT_A] }, ctx);

        expect(result.clearedDrafts).toBe(0);
        expect(ctx.em.flush).not.toHaveBeenCalled();
    });
});
