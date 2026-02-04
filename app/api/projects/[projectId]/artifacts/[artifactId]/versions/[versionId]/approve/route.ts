import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { initNextjsWorkerContext } from '@/lib/local/context';
import { approveArtifactHandler } from '@/workers/chat/src/artifact-approver';

type RouteParams = { projectId: string; artifactId: string; versionId: string };

async function handleApproveVersion(
    _req: NextRequest,
    { versionId }: RouteParams,
    _user: UserEntity,
): Promise<NextResponse> {
    const ctx = await initNextjsWorkerContext({ skipAI: false });
    const result = await approveArtifactHandler({ versionId }, ctx);

    return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: { params: Promise<RouteParams> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const resolvedParams = await params;
        return await handleApproveVersion(request, resolvedParams, user);
    })(req);
}
