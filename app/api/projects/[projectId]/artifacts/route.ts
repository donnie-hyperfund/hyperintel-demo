import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleListProjectArtifacts } from '@/lib/artifacts/handlers';

/**
 * GET /api/projects/[projectId]/artifacts
 *
 * Convenience wrapper — delegates to the shared handleListProjectArtifacts handler
 * with projectId pre-filled from the URL param.
 */
export function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return handleListProjectArtifacts(request, projectId, user);
    })(req);
}
