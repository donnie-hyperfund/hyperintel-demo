import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { type ArtifactDto } from '@/lib/schema/artifact';

const ERRORS = {
    ARTIFACT_NOT_FOUND: NextResponse.json({ error: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 }),
};

async function handleGetArtifact(
    req: NextRequest,
    projectId: string,
    artifactId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const artifact = await em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoinAndSelect('a.current_version', 'cv')
        .leftJoin('a.chat', 'c')
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

    const dto: ArtifactDto = wrap(artifact).toJSON();
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
