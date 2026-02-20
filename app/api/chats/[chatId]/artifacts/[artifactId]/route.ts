import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleGetChatArtifact } from '@/lib/chats/handlers';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string; artifactId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { chatId, artifactId } = await params;
        return handleGetChatArtifact(chatId, artifactId, user);
    })(req);
}
