import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { loadVersionsForArtifacts } from '@/lib/artifacts/queries';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';

/**
 * GET /api/artifacts — List user-scoped artifacts (intake results).
 *
 * Returns artifacts where project_id IS NULL and user_id = current user.
 * Used by the frontend to show available intake documents for import.
 */
async function handleGetUserArtifacts(_req: NextRequest, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const artifacts = await em.find(
        ArtifactEntity,
        { user: user.id, project: null },
        { orderBy: { created_at: 'DESC' } },
    );

    const artifactIds = artifacts.map((a) => a.id);
    const latestByArtifact = await loadVersionsForArtifacts(em, artifactIds);

    const mapped = artifacts.map((artifact) => {
        const latest = latestByArtifact.get(artifact.id);
        return {
            ...wrap(artifact).toJSON(),
            proposed_version: latest ? wrap(latest).toJSON() : undefined,
        };
    });

    return NextResponse.json(mapped);
}

export function GET(req: NextRequest): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        return handleGetUserArtifacts(request, user);
    })(req);
}
