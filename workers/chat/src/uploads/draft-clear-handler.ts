/**
 * Handler for /uploads/drafts/clear.
 * Flips `is_draft = false` on the listed artifacts so they become visible in project resource
 * lists. Only clears rows owned by the authenticated user (via `user_id` on scoped rows or
 * `metadata.stagedBy` on still-staged rows) so callers cannot un-draft someone else's uploads.
 * Intentionally orthogonal to `/uploads/associate`: associate sets scope, clear-drafts sets
 * visibility. Both can be called in the same send flow.
 */

import { raw } from '@mikro-orm/core';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import type { ClearDraftsDto } from '@/lib/schema/artifact';
import type { Ctx } from '../context';
import { resolveDbUserId } from './scope';

export interface ClearDraftsResult {
    clearedDrafts: number;
}

export async function clearDraftsHandler(data: ClearDraftsDto, ctx: Ctx): Promise<ClearDraftsResult> {
    const { em, user } = ctx;
    const { artifactIds } = data;

    const dbUserId = await resolveDbUserId(em, user);

    const drafts = await em.find(ArtifactEntity, {
        id: { $in: artifactIds },
        is_draft: true,
        $or: [{ user: dbUserId }, { [raw("metadata->>'stagedBy'")]: dbUserId }],
    });

    if (drafts.length === 0) return { clearedDrafts: 0 };

    for (const artifact of drafts) {
        artifact.is_draft = false;
    }

    await em.flush();

    return { clearedDrafts: drafts.length };
}
