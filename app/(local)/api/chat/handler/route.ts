import { type NextRequest, NextResponse } from 'next/server';
import { BadRequestError } from '@/common/common/error.helpers';
import { assertAuth } from '@/lib/api/auth-guard';
import { getOrCreateRequestId, withRequestIdHeader } from '@/lib/api/request-id';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { SendChatActionSchema } from '@/lib/schema/chat';
import { chatActionHandler } from '@/workers/chat/src/chat-handler';
import type { Ctx } from '@/workers/chat/src/context';

export async function POST(req: NextRequest) {
    const requestId = getOrCreateRequestId(req.headers);
    const _user = await assertAuth();
    const json = await req.json();
    const parsed = SendChatActionSchema.safeParse(json);
    if (!parsed.success) {
        return withRequestIdHeader(
            new BadRequestError({
                message: 'Invalid data',
                code: 'BAD_REQUEST',
                details: {
                    message: parsed.error.message,
                },
            }).getNextResponse(),
            requestId,
        );
    }

    const ctx = (await initNextjsWorkerContext({ skipAI: false })) as Ctx;
    ctx.requestId = requestId;
    // Pass no-op onEvent to get direct result (not SSE stream — no proxy DO locally)
    const result = await chatActionHandler(parsed.data, ctx, { onEvent: () => {} });

    return withRequestIdHeader(NextResponse.json(result), requestId);
}
