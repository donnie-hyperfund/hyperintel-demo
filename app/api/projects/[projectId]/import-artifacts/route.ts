import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { validatePayload } from '@/lib/api/validation';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { ImportArtifactsBodySchema } from '@/lib/schema/project';
import { importArtifactsHandler } from '@/workers/chat/src/artifact-importer';

export function POST(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, _user) => {
        const { projectId } = await params;

        const body = await request.json();
        const bodyData = validatePayload(ImportArtifactsBodySchema, body);
        if (bodyData instanceof NextResponse) return bodyData;

        const ctx = await initNextjsWorkerContext({ skipAI: true });
        const result = await importArtifactsHandler(
            { projectId, artifactIds: bodyData.artifactIds },
            ctx,
        );

        return NextResponse.json(result);
    })(req);
}
