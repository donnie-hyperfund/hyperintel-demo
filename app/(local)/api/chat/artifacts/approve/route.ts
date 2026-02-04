import { type NextRequest, NextResponse } from 'next/server';
import { BadRequestError } from '@/common/common/error.helpers';
import { assertAuth } from '@/lib/api/auth-guard';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { ApproveArtifactActionSchema } from '@/lib/schema/artifact';
import { approveArtifactHandler } from '@/workers/chat/src/artifact-approver';

export async function POST(req: NextRequest) {
    await assertAuth();
    const json = await req.json();
    const parsed = ApproveArtifactActionSchema.safeParse(json);
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
    const result = await approveArtifactHandler(parsed.data, ctx);

    return NextResponse.json(result);
}
