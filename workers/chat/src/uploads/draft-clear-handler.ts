/**
 * Handler for /uploads/drafts/clear.
 * Flips `is_draft = false` on the listed artifacts so they become visible in project resource
 * lists. Only clears rows the caller owns via any of the codebase's ownership paths — direct
 * `user_id` (associated / published / agent-created), `metadata.stagedBy` (pre-associate staged),
 * `project.user` (project-scoped), or `chat.user` (chat-only intake). Matches the authz pattern
 * used by artifact-approver, artifact-deleter, and handleGetFileStatuses.
 *
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

    const drafts = await em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.project', 'p')
        .leftJoin('a.chat', 'c')
        .where({
            'a.id': { $in: artifactIds },
            'a.is_draft': true,
            $or: [
                { 'a.user': dbUserId },
                { [raw("a.metadata->>'stagedBy'")]: dbUserId },
                { 'p.user': dbUserId },
                { 'c.user': dbUserId },
            ],
        })
        .getResultList();

    if (drafts.length === 0) return { clearedDrafts: 0 };

    for (const artifact of drafts) {
        artifact.is_draft = false;
    }

    await em.flush();

    return { clearedDrafts: drafts.length };
}
