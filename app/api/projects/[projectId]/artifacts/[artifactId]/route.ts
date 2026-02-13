import { wrap } from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/knex';

import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { type ArtifactDto, GetArtifactQuerySchema } from '@/lib/schema/artifact';

type RouteParams = { projectId: string; artifactId: string };
type ErrorCode = keyof typeof ERROR_TEXT;

const ERROR_TEXT = {
    ARTIFACT_NOT_FOUND: 'Artifact not found',
    VERSION_NOT_FOUND: 'Version not found',
    ALREADY_DELETED: 'Artifact is already deleted',
} as const;

function jsonError(code: ErrorCode, status: number) {
    return NextResponse.json({ message: ERROR_TEXT[code], code }, { status });
}

const RESPONSES = {
    artifactNotFound: () => jsonError('ARTIFACT_NOT_FOUND', 404),
    versionNotFound: () => jsonError('VERSION_NOT_FOUND', 404),
    alreadyDeleted: () => jsonError('ALREADY_DELETED', 400),
} as const;

function findArtifactForProjectOwner(
    em: SqlEntityManager,
    args: { projectId: string; artifactId: string; ownerUserId: string },
): Promise<ArtifactEntity | null> {
    const { projectId, artifactId, ownerUserId } = args;

    return em
        .createQueryBuilder(ArtifactEntity, 'artifact')
        .select('artifact.*')
        .leftJoinAndSelect('artifact.current_version', 'currentVersion')
        .leftJoin('artifact.project', 'project')
        .where({
            'artifact.id': artifactId,
            'project.id': projectId,
            'project.user': ownerUserId,
        })
        .getSingleResult();
}

function findProposedArtifactVersion(em: SqlEntityManager, artifactId: string) {
    return em.findOne(ArtifactVersionEntity, {
        artifact: artifactId,
        status: 'proposed',
    });
}

function findArtifactVersionByNumber(em: SqlEntityManager, artifactId: string, version?: number) {
    if (version === undefined) return null;

    return em.findOne(ArtifactVersionEntity, {
        artifact: artifactId,
        version,
    });
}

async function getArtifact(
    req: NextRequest,
    projectId: string,
    artifactId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();
    const query = GetArtifactQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const artifact = await findArtifactForProjectOwner(em, {
        projectId,
        artifactId,
        ownerUserId: user.id,
    });
    if (!artifact) return RESPONSES.artifactNotFound();

    // TODO: Extra query - could join versions in main query instead
    const [proposedVersion, requestedVersion] = await Promise.all([
        findProposedArtifactVersion(em, artifact.id),
        findArtifactVersionByNumber(em, artifact.id, query.version),
    ]);

    if (query.version !== undefined && !requestedVersion) return RESPONSES.versionNotFound();

    const dto: ArtifactDto = {
        ...wrap(artifact).toJSON(),
        proposed_version: proposedVersion ? wrap(proposedVersion).toJSON() : undefined,
        loaded_version: requestedVersion ? wrap(requestedVersion).toJSON() : undefined,
    };

    return NextResponse.json(dto);
}

async function deleteArtifact(
    _req: NextRequest,
    projectId: string,
    artifactId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const artifact = await findArtifactForProjectOwner(em, {
        projectId,
        artifactId,
        ownerUserId: user.id,
    });
    if (!artifact) return RESPONSES.artifactNotFound();

    // Use current_version if available, otherwise find the newest version (e.g. still proposed)
    const targetVersion =
        artifact.current_version ??
        (await em.findOne(ArtifactVersionEntity, { artifact: artifact.id }, { orderBy: { version: 'DESC' } }));

    if (!targetVersion) return RESPONSES.artifactNotFound();
    if (targetVersion.status === 'deleted') return RESPONSES.alreadyDeleted();

    targetVersion.status = 'deleted';
    targetVersion.status_changed_at = new Date();
    targetVersion.status_changed_by = user.id;

    // Point current_version at the deleted version to reflect the status
    if (!artifact.current_version) {
        artifact.current_version = targetVersion;
    }

    await em.flush();

    return NextResponse.json({ success: true, message: 'Artifact deleted' });
}

export function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, artifactId } = await params;
        return getArtifact(request, projectId, artifactId, user);
    })(req);
}

export function DELETE(req: NextRequest, { params }: { params: Promise<RouteParams> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, artifactId } = await params;
        return deleteArtifact(request, projectId, artifactId, user);
    })(req);
}
