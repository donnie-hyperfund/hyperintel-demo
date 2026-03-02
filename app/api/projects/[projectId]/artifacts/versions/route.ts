import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { validatePayload } from '@/lib/api/validation';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { getOrm } from '@/lib/orm/orm';
import { ListArtifactVersionsQuerySchema } from '@/lib/schema/artifact';

async function handleGetVersions(req: NextRequest, projectId: string, userId: string): Promise<NextResponse> {
    const { em } = await getOrm();

    const queryData = validatePayload(ListArtifactVersionsQuerySchema, {
        key: req.nextUrl.searchParams.get('key') ?? undefined,
    });
    if (queryData instanceof NextResponse) return queryData;

    const key = normalizeArtifactKey(queryData.key);

    const artifact = await em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.project', 'p')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({
            'a.key': key,
            'p.id': projectId,
            'p.user': userId,
        })
        .getSingleResult();

    if (!artifact) {
        return NextResponse.json({ error: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 });
    }

    const versions = await em.find(ArtifactVersionEntity, { artifact: artifact.id }, { orderBy: { version: 'DESC' } });

    return NextResponse.json({
        artifact: {
            id: artifact.id,
            key: artifact.key,
            title: artifact.title,
            latestVersion: artifact.version,
            currentVersion: artifact.current_version?.version ?? null,
        },
        versions: versions.map((v) => wrap(v).toJSON()),
    });
}

export function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return handleGetVersions(request, projectId, user.id);
    })(req);
}
