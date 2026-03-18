import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleImportArtifacts } from '@/lib/artifacts/handlers';

export function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return handleImportArtifacts(request, user, projectId);
    })(req);
}
