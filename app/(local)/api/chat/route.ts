import { type NextRequest, NextResponse } from 'next/server';
import { assertAuth } from '@/lib/api/auth-guard';
import { SendConversationActionSchema } from '@/lib/schema/chat';
import { BadRequestError } from '@/common/common/error.helpers';
import { wrapHandlerRaw } from '@/common/common/common.helpers';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { chatActionHandler } from '@/workers/chat/src/chat-handler';

export async function POST(req: NextRequest) {
    return wrapHandlerRaw(async () => {
        const user = await assertAuth();
        // TODO helper/wrapper for schema validation?
        const json = await req.json();
        const parsed = SendConversationActionSchema.safeParse(json);
        if (!parsed.success) {
            return new BadRequestError({
                message: 'Invalid data',
                code: 'BAD_REQUEST',
                details: {
                    message: parsed.error.message,
                },
            }).getNextResponse();
        }
        const ctx = await initNextjsWorkerContext({  skipAI: true });
        return await chatActionHandler(parsed.data, ctx);
    });
}