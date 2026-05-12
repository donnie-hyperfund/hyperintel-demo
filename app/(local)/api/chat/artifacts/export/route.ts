import { type NextRequest } from 'next/server';
import { BadRequestError } from '@/common/common/error.helpers';
import { assertAuth } from '@/lib/api/auth-guard';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { ExportArtifactQuerySchema } from '@/lib/schema/artifact';
import { exportArtifactHandler } from '@/workers/chat/src/artifact-exporter';

export async function GET(req: NextRequest) {
    await assertAuth();
    const raw = Object.fromEntries(req.nextUrl.searchParams);
    const parsed = ExportArtifactQuerySchema.safeParse(raw);
    if (!parsed.success) {
        return new BadRequestError({
            message: 'Invalid query parameters',
            code: 'BAD_REQUEST',
            details: { message: parsed.error.message },
        }).getNextResponse();
    }

    const ctx = await initNextjsWorkerContext<ChatEnv>({ skipAI: true });
    return await exportArtifactHandler(parsed.data, ctx);
}
