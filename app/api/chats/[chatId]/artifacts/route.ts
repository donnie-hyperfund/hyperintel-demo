import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleListChatArtifacts } from '@/lib/chats/handlers';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { chatId } = await params;
        return handleListChatArtifacts(request, chatId, user);
    })(req);
}
