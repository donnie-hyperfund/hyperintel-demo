import { type NextRequest, NextResponse } from 'next/server';
import { initNextjsWorkerContext } from '@/lib/local/context';

export async function POST(req: NextRequest) {
    const { chatId, agentMessageId } = await req.json();
    if (!agentMessageId || typeof agentMessageId !== 'string') {
        return NextResponse.json({ error: 'agentMessageId required' }, { status: 400 });
    }
    if (!chatId || typeof chatId !== 'string') {
        return NextResponse.json({ error: 'chatId required' }, { status: 400 });
    }

    const ctx = await initNextjsWorkerContext({ skipAuth: true, skipDatabase: true, skipAI: true });
    const streamDO = ctx.env.CHAT_STREAM_DO.get(ctx.env.CHAT_STREAM_DO.idFromName(agentMessageId));
    await streamDO.abort(chatId);

    return NextResponse.json({ ok: true });
}
