import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { type ArtifactDto, GetArtifactQuerySchema } from '@/lib/schema/artifact';

const ERRORS = {
    ARTIFACT_NOT_FOUND: NextResponse.json({ error: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 }),
    VERSION_NOT_FOUND: NextResponse.json({ error: 'Version not found', code: 'VERSION_NOT_FOUND' }, { status: 404 }),
};

async function handleGetArtifact(
    req: NextRequest,
    projectId: string,
    artifactId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const query = GetArtifactQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const artifact = await em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoinAndSelect('a.current_version', 'cv')
        .leftJoin('a.project', 'p')
        .where({
            'a.id': artifactId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .getSingleResult();

    if (!artifact) {
        return ERRORS.ARTIFACT_NOT_FOUND;
    }

    // TODO: Extra query - could join versions in main query instead
    const proposedVersion = await em.findOne(ArtifactVersionEntity, {
        artifact: artifact.id,
        status: 'proposed',
    });

    // Load specific version if requested via ?version=N
    let loadedVersion: ArtifactVersionEntity | null = null;
    if (query.version !== undefined) {
        loadedVersion = await em.findOne(ArtifactVersionEntity, {
            artifact: artifact.id,
            version: query.version,
        });
        if (!loadedVersion) {
            return ERRORS.VERSION_NOT_FOUND;
        }
    }

    const dto: ArtifactDto = {
        ...wrap(artifact).toJSON(),
        proposed_version: proposedVersion ? wrap(proposedVersion).toJSON() : undefined,
        loaded_version: loadedVersion ? wrap(loadedVersion).toJSON() : undefined,
    };
    return NextResponse.json(dto);
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; artifactId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, artifactId } = await params;
        return await handleGetArtifact(request, projectId, artifactId, user);
    })(req);
}
