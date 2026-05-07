import { type NextRequest, NextResponse } from 'next/server';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { AbortActionSchema } from '@/lib/schema/chat';

export async function POST(req: NextRequest) {
    const parsed = AbortActionSchema.safeParse(await req.json());
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid data', details: parsed.error.message }, { status: 400 });
    }

    const { chatId, agentMessageId } = parsed.data;
    const ctx = await initNextjsWorkerContext<ChatEnv>({ skipAuth: true, skipDatabase: true, skipAI: true });
    const streamDO = ctx.env.CHAT_STREAM_DO.get(ctx.env.CHAT_STREAM_DO.idFromName(agentMessageId));
    await streamDO.abort(chatId);

    return NextResponse.json({ ok: true });
}
