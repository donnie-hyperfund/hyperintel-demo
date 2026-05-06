import { type NextRequest, NextResponse } from 'next/server';
import { BadRequestError } from '@/common/common/error.helpers';
import { assertAuth } from '@/lib/api/auth-guard';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { DeleteArtifactSchema } from '@/lib/schema/artifact';
import { deleteArtifactHandler } from '@/workers/chat/src/artifact-deleter';

export async function POST(req: NextRequest) {
    await assertAuth();
    const json = await req.json();
    const parsed = DeleteArtifactSchema.safeParse(json);
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
    const result = await deleteArtifactHandler(parsed.data, ctx);

    return NextResponse.json(result);
}
