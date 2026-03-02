import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleRemoveProjectResource } from '@/lib/artifacts/handlers';

type RouteParams = { projectId: string; artifactId: string };

export function DELETE(req: NextRequest, { params }: { params: Promise<RouteParams> }): Promise<NextResponse> {
    return withAuth(async (_request, user) => {
        const { projectId, artifactId } = await params;
        return await handleRemoveProjectResource(projectId, artifactId, user);
    })(req);
}
