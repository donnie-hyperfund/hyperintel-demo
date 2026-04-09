import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';
import { assertAuth } from '@/lib/api/auth-guard';
import { IS_DEV } from '@/lib/config';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { createR2Client, getR2CredentialsFromEnv } from '@/lib/vendor/r2';

const SIGN_EXPIRY_SECONDS = 60 * 60; // 1 hour

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
    const user = await assertAuth();
    const { key: keyParts } = await params;
    const key = keyParts.join('/');

    // Key pattern: uploads/{project|chat}/{id}/{versionId}/images/{filename}
    if (!key.startsWith('uploads/') || keyParts.length < 5) {
        return NextResponse.json({ error: 'Invalid artifact image key' }, { status: 404 });
    }

    const scopeType = keyParts[1]; // 'project' or 'chat'
    const scopeId = keyParts[2];

    const ctx = await initNextjsWorkerContext({ skipAI: true });
    const em = ctx.em;

    if (scopeType === 'project') {
        const project = await em.findOne(ProjectEntity, {
            id: scopeId,
            user: { clerkId: user.userId },
            archived_at: null,
        });
        if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    } else if (scopeType === 'chat') {
        const chat = await em.findOne(ChatEntity, {
            id: scopeId,
            $or: [{ project: { user: { clerkId: user.userId } } }, { user: { clerkId: user.userId } }],
        });
        if (!chat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    } else {
        return NextResponse.json({ error: 'Invalid artifact image key' }, { status: 404 });
    }

    const creds = getR2CredentialsFromEnv();
    if (!creds) return NextResponse.json({ error: 'R2 credentials not configured' }, { status: 500 });

    const s3 = createR2Client(creds);
    const bucket = IS_DEV ? 'hi-artifacts-dev' : 'hi-artifacts';
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: SIGN_EXPIRY_SECONDS });

    return new Response(null, {
        status: 302,
        headers: {
            Location: signedUrl,
            'Cache-Control': 'private, max-age=3000',
        },
    });
}
