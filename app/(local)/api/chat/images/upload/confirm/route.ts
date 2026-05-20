import { type NextRequest, NextResponse } from 'next/server';
import { BadRequestError, PublicError } from '@/common/common/error.helpers';
import { assertAuth } from '@/lib/api/auth-guard';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { ConfirmImageUploadSchema, confirmImageUploadHandler } from '@/workers/chat/src/uploads/image-uploader';

export async function POST(req: NextRequest) {
    await assertAuth();
    const json = await req.json();
    const parsed = ConfirmImageUploadSchema.safeParse(json);
    if (!parsed.success) {
        return new BadRequestError({
            message: 'Invalid data',
            code: 'BAD_REQUEST',
            details: { message: parsed.error.message },
        }).getNextResponse();
    }

    try {
        const ctx = await initNextjsWorkerContext<ChatEnv>({ skipAI: true });
        const result = await confirmImageUploadHandler(parsed.data, ctx);
        return NextResponse.json(result);
    } catch (err) {
        if (err instanceof PublicError) return err.getNextResponse();
        throw err;
    }
}
