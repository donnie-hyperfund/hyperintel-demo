import { type NextRequest, NextResponse } from 'next/server';
import { BadRequestError } from '@/common/common/error.helpers';
import { assertAuth } from '@/lib/api/auth-guard';
import { getOrCreateRequestId, withRequestIdHeader } from '@/lib/api/request-id';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { SendIntakeChatActionSchema } from '@/lib/schema/chat';
import type { Ctx } from '@/workers/chat/src/context';
import { intakeActionHandler } from '@/workers/chat/src/intake-handler';

export async function POST(req: NextRequest) {
    const requestId = getOrCreateRequestId(req.headers);
    await assertAuth();
    const json = await req.json();
    const parsed = SendIntakeChatActionSchema.safeParse(json);
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
    const result = await intakeActionHandler(parsed.data, ctx, { onEvent: () => {} });

    return withRequestIdHeader(NextResponse.json(result), requestId);
}
