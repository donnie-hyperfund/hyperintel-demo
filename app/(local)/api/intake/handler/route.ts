import { type NextRequest, NextResponse } from 'next/server';
import { BadRequestError } from '@/common/common/error.helpers';
import { assertAuth } from '@/lib/api/auth-guard';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { SendIntakeChatActionSchema } from '@/lib/schema/chat';
import { intakeActionHandler } from '@/workers/chat/src/intake-handler';

export async function POST(req: NextRequest) {
    const user = await assertAuth();
    const json = await req.json();
    const parsed = SendIntakeChatActionSchema.safeParse(json);
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
    // Pass no-op onEvent to get direct result (not SSE stream — no proxy DO locally)
    const result = await intakeActionHandler(parsed.data, ctx, { onEvent: () => {} });

    return NextResponse.json(result);
}
