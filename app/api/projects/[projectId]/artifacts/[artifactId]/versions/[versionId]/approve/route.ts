import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';

const ERRORS = {
    VERSION_NOT_FOUND: NextResponse.json(
        { error: 'Version not found', code: 'VERSION_NOT_FOUND' },
        { status: 404 },
    ),
    INVALID_STATUS: (status: string) =>
        NextResponse.json(
            { error: `Cannot approve version with status '${status}'`, code: 'INVALID_STATUS' },
            { status: 400 },
        ),
};

type RouteParams = { projectId: string; artifactId: string; versionId: string };

async function handleApproveVersion(
    _req: NextRequest,
    { projectId, artifactId, versionId }: RouteParams,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    // Find the version and verify ownership through project
    const version = await em
        .createQueryBuilder(ArtifactVersionEntity, 'v')
        .select('v.*')
        .leftJoinAndSelect('v.artifact', 'a')
        .leftJoin('a.project', 'p')
        .where({
            'v.id': versionId,
            'a.id': artifactId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .getSingleResult();

    if (!version) {
        return ERRORS.VERSION_NOT_FOUND;
    }

    if (version.status !== 'proposed') {
        return ERRORS.INVALID_STATUS(version.status);
    }

    // Approve the version
    version.status = 'approved';
    version.status_changed_at = new Date();
    version.status_changed_by = user.id;

    // Update artifact's current_version
    version.artifact.current_version = version;

    await em.flush();

    return NextResponse.json({
        success: true,
        version: version.version,
        status: 'approved',
    });
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<RouteParams> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const resolvedParams = await params;
        return await handleApproveVersion(request, resolvedParams, user);
    })(req);
}
