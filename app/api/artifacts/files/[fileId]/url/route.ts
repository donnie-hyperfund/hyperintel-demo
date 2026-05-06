import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';
import { assertAuth } from '@/lib/api/auth-guard';
import { IS_DEV } from '@/lib/config';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { getOrm } from '@/lib/orm/orm';
import { createR2Client, getR2CredentialsFromEnv } from '@/lib/vendor/r2';

const SIGN_EXPIRY_SECONDS = 60 * 60; // 1 hour

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
    const user = await assertAuth();
    const { fileId } = await params;
    const { em } = await getOrm();

    const file = await em.findOne(
        ArtifactFileEntity,
        { id: fileId },
        { populate: ['artifact_version.artifact.project.user', 'artifact_version.artifact.user'] },
    );
    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Ownership check
    const artifact = file.artifact_version.artifact;
    const projectUserId = artifact.project?.user?.id;
    const artifactUserId = typeof artifact.user === 'object' ? artifact.user?.id : artifact.user;
    if (projectUserId !== user.id && artifactUserId !== user.id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (file.status === 'pending_upload') {
        return NextResponse.json({ error: 'File not yet uploaded' }, { status: 400 });
    }

    const creds = getR2CredentialsFromEnv();
    if (!creds) return NextResponse.json({ error: 'R2 credentials not configured' }, { status: 500 });

    const s3 = createR2Client(creds);
    const bucket = IS_DEV ? 'hi-artifacts-dev' : 'hi-artifacts';
    const command = new GetObjectCommand({ Bucket: bucket, Key: file.storage_key });
    const url = await getSignedUrl(s3, command, { expiresIn: SIGN_EXPIRY_SECONDS });

    return NextResponse.json({ url });
}
