import { type NextRequest, NextResponse } from 'next/server';
import { BadRequestError, PublicError } from '@/common/common/error.helpers';
import { assertAuth } from '@/lib/api/auth-guard';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { UploadArtifactSchema } from '@/lib/schema/artifact';
import { uploadArtifactHandler } from '@/workers/chat/src/uploads/artifact-uploader';

export async function POST(req: NextRequest) {
    await assertAuth();

    const parsed = UploadArtifactSchema.safeParse(await req.formData());
    if (!parsed.success) {
        return new BadRequestError({
            message: 'Invalid upload data',
            code: 'BAD_REQUEST',
            details: { message: parsed.error.message },
        }).getNextResponse();
    }

    try {
        const ctx = await initNextjsWorkerContext<ChatEnv>({ skipAI: false });
        const result = await uploadArtifactHandler(parsed.data, ctx);
        return NextResponse.json(result);
    } catch (err) {
        if (err instanceof PublicError) return err.getNextResponse();
        throw err;
    }
}
