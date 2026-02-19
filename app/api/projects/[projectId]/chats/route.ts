import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleListChats } from '@/lib/chats/handlers';

/**
 * GET /api/projects/[projectId]/chats
 *
 * Convenience wrapper — delegates to the shared handleListChats handler
 * with projectId pre-filled from the URL param.
 */
export function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return handleListChats(request, user, projectId);
    })(req);
}
