import { GetObjectCommand } from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { assertAuth } from '@/lib/api/auth-guard';
import { IS_DEV } from '@/lib/config';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { createR2Client, getR2CredentialsFromEnv } from '@/lib/vendor/r2';

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
    const user = await assertAuth();
    const { fileId } = await params;

    const ctx = await initNextjsWorkerContext({ skipAI: true });
    const em = ctx.em;

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
    const r2Response = await s3.send(command);

    if (!r2Response.Body) return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });

    // @ts-expect-error — Body is a Readable stream
    return new Response(r2Response.Body, {
        headers: {
            'Content-Type': file.mime_type,
            'Cache-Control': 'private, max-age=3600',
            'Content-Disposition': `inline; filename="${file.original_name}"`,
        },
    });
}
