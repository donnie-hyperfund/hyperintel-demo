import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';
import { assertAuth } from '@/lib/api/auth-guard';
import { deriveThumbnailKey, generateThumbnail } from '@/lib/artifacts/artifact-thumbnails';
import { IS_DEV } from '@/lib/config';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { getOrm } from '@/lib/orm/orm';
import { createR2Client, getR2CredentialsFromEnv } from '@/lib/vendor/r2';

const SIGN_EXPIRY_SECONDS = 60 * 60; // 1 hour
const CACHE_MAX_AGE = 86400; // 24 hours — thumbnails are immutable once generated

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

    // Ownership check (same as /url endpoint)
    const artifact = file.artifact_version.artifact;
    const projectUserId = artifact.project?.user?.id;
    const artifactUserId = typeof artifact.user === 'object' ? artifact.user?.id : artifact.user;
    if (projectUserId !== user.id && artifactUserId !== user.id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (file.status === 'pending_upload') {
        return NextResponse.json({ error: 'File not yet uploaded' }, { status: 400 });
    }

    if (!file.mime_type.startsWith('image/')) {
        return NextResponse.json({ error: 'Not an image file' }, { status: 404 });
    }

    const creds = getR2CredentialsFromEnv();
    if (!creds) return NextResponse.json({ error: 'R2 credentials not configured' }, { status: 500 });

    const s3 = createR2Client(creds);
    const bucket = IS_DEV ? 'hi-artifacts-dev' : 'hi-artifacts';
    const thumbnailKey = deriveThumbnailKey(file.storage_key);

    // Check if thumbnail already exists in R2
    try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: thumbnailKey }));
        // Thumbnail exists — redirect to presigned URL
        const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: thumbnailKey }), {
            expiresIn: SIGN_EXPIRY_SECONDS,
        });
        return new Response(null, {
            status: 302,
            headers: { Location: url, 'Cache-Control': `private, max-age=${CACHE_MAX_AGE}` },
        });
    } catch {
        // Thumbnail doesn't exist — generate it
    }

    // Fetch original image from R2
    let originalBytes: Buffer;
    try {
        const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: file.storage_key }));
        if (!response.Body) return NextResponse.json({ error: 'Original image not found' }, { status: 404 });
        originalBytes = Buffer.from(await response.Body.transformToByteArray());
    } catch {
        return NextResponse.json({ error: 'Original image not found' }, { status: 404 });
    }

    // Generate thumbnail
    let thumbnailBytes: Buffer;
    try {
        thumbnailBytes = await generateThumbnail(originalBytes);
    } catch {
        return NextResponse.json({ error: 'Failed to generate thumbnail' }, { status: 500 });
    }

    // Upload thumbnail to R2
    await s3.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: thumbnailKey,
            Body: thumbnailBytes,
            ContentType: 'image/webp',
        }),
    );

    // Redirect to the newly created thumbnail
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: thumbnailKey }), {
        expiresIn: SIGN_EXPIRY_SECONDS,
    });
    return new Response(null, {
        status: 302,
        headers: { Location: url, 'Cache-Control': `private, max-age=${CACHE_MAX_AGE}` },
    });
}
