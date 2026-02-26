import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';

type RouteParams = { artifactId: string };

async function handleDelete(req: NextRequest, user: UserEntity, artifactId: string): Promise<NextResponse> {
    const { em } = await getOrm();

    const artifact = await em.findOne(
        ArtifactEntity,
        { id: artifactId, $or: [{ user: user.id }, { project: { user: user.id } }] },
        { populate: ['current_version'] },
    );

    if (!artifact) {
        return NextResponse.json({ message: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 });
    }

    const targetVersion =
        artifact.current_version ??
        (await em.findOne(ArtifactVersionEntity, { artifact: artifact.id }, { orderBy: { version: 'DESC' } }));

    if (!targetVersion) {
        return NextResponse.json({ message: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 });
    }

    if (targetVersion.status === 'deleted') {
        return NextResponse.json({ message: 'Artifact is already deleted', code: 'ALREADY_DELETED' }, { status: 400 });
    }

    if (!targetVersion.is_uploaded) {
        return NextResponse.json(
            { message: 'Only uploaded artifacts can be deleted', code: 'NOT_UPLOADED_ARTIFACT' },
            { status: 403 },
        );
    }

    targetVersion.status = 'deleted';
    targetVersion.status_changed_at = new Date();
    targetVersion.status_changed_by = user.id;

    if (!artifact.current_version) {
        artifact.current_version = targetVersion;
    }

    await em.flush();

    return NextResponse.json({ success: true, message: 'Artifact deleted' });
}

export function DELETE(req: NextRequest, { params }: { params: Promise<RouteParams> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { artifactId } = await params;
        return handleDelete(request, user, artifactId);
    })(req);
}
