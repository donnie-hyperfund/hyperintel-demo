import { type NextRequest, NextResponse } from 'next/server';
import { BadRequestError } from '@/common/common/error.helpers';
import { assertAuth } from '@/lib/api/auth-guard';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { SummarizeActionSchema } from '@/lib/schema/chat';
import { summarizeActionHandler } from '@/workers/chat/src/summarizer';

export async function POST(req: NextRequest) {
    const user = await assertAuth();
    const json = await req.json();
    const parsed = SummarizeActionSchema.safeParse(json);
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
    const result = await summarizeActionHandler(parsed.data, ctx, { onEvent: () => {} });

    return NextResponse.json(result);
}
