import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';
import { assertAuth } from '@/lib/api/auth-guard';
import { IS_DEV } from '@/lib/config';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { getOrm } from '@/lib/orm/orm';
import { createR2Client, getR2CredentialsFromEnv } from '@/lib/vendor/r2';

const SIGN_EXPIRY_SECONDS = 60 * 60; // 1 hour

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
    const user = await assertAuth();
    const { fileId } = await params;
    const { em } = await getOrm();

    const file = await em.findOne(ChatMessageFileEntity, { id: fileId });
    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const chat = await em.findOne(ChatEntity, {
        id: file.chat_id,
        $or: [{ project: { user: { clerkId: user.clerkId } } }, { user: { clerkId: user.clerkId } }],
    });
    if (!chat) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const creds = getR2CredentialsFromEnv();
    if (!creds) return NextResponse.json({ error: 'R2 credentials not configured' }, { status: 500 });

    const s3 = createR2Client(creds);
    const bucket = IS_DEV ? 'hi-user-images-dev' : 'hi-user-images';
    const command = new GetObjectCommand({ Bucket: bucket, Key: file.storage_key });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: SIGN_EXPIRY_SECONDS });

    return new Response(null, {
        status: 302,
        headers: {
            Location: signedUrl,
            'Cache-Control': 'private, max-age=3000',
        },
    });
}
