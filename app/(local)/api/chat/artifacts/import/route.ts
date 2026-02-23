import { type NextRequest, NextResponse } from 'next/server';
import { BadRequestError } from '@/common/common/error.helpers';
import { assertAuth } from '@/lib/api/auth-guard';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { ImportArtifactsActionSchema } from '@/lib/schema/project';
import { importArtifactsHandler } from '@/workers/chat/src/artifact-importer';

export async function POST(req: NextRequest) {
    await assertAuth();
    const json = await req.json();
    const parsed = ImportArtifactsActionSchema.safeParse(json);
    if (!parsed.success) {
        return new BadRequestError({
            message: 'Invalid data',
            code: 'BAD_REQUEST',
            details: {
                message: parsed.error.message,
            },
        }).getNextResponse();
    }

    const ctx = await initNextjsWorkerContext({ skipAI: true });
    const result = await importArtifactsHandler(parsed.data, ctx);

    return NextResponse.json(result);
}
