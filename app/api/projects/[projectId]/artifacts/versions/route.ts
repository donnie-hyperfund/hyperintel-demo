import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleGetVersions } from '@/lib/artifacts/handlers';

export function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return handleGetVersions(request, projectId, user.id);
    })(req);
}
