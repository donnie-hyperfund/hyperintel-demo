import { type NextRequest } from 'next/server';
import { assertAuth } from '@/lib/api/auth-guard';
import { SendChatActionSchema } from '@/lib/schema/chat';
import { BadRequestError } from '@/common/common/error.helpers';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { chatActionHandler } from '@/workers/chat/src/chat-handler';

export async function POST(req: NextRequest) {
    const user = await assertAuth();
    const json = await req.json();
    const parsed = SendChatActionSchema.safeParse(json);
    if (!parsed.success) {
        return new BadRequestError({
            message: 'Invalid data',
            code: 'BAD_REQUEST',
            details: {
                message: parsed.error.message,
            },
        }).getNextResponse();
    }

    const ctx = await initNextjsWorkerContext({ skipAI: false });
    const stream = await chatActionHandler(parsed.data, ctx);

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
