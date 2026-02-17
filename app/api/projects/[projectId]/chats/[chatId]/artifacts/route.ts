import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleListChatArtifacts } from '@/lib/chats/handlers';

export function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, chatId } = await params;
        return handleListChatArtifacts(request, chatId, user, projectId);
    })(req);
}
