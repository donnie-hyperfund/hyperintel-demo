import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { assertAuth } from '@/lib/api/auth-guard';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
    const user = await assertAuth();
    const { fileId } = await params;

    const ctx = await initNextjsWorkerContext({ skipAI: true });
    const em = ctx.em;

    const file = await em.findOne(ChatMessageFileEntity, { id: fileId });
    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const chat = await em.findOne(ChatEntity, {
        id: file.chat_id,
        $or: [
            { project: { user: { clerkId: user.userId } } },
            { user: { clerkId: user.userId } },
        ],
    });
    if (!chat) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const accountId = process.env.CF_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
        return NextResponse.json({ error: 'R2 credentials not configured' }, { status: 500 });
    }

    const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
    });

    const bucket = process.env.NODE_ENV === 'production' ? 'hi-user-images' : 'hi-user-images-dev';
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
