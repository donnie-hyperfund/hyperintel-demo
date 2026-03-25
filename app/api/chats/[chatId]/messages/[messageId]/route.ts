import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleGetMessage } from '@/lib/chats/handlers';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string; messageId: string }> },
): Promise<NextResponse> {
    return withAuth(async (_request, user) => {
        const { chatId, messageId } = await params;
        return handleGetMessage(chatId, messageId, user);
    })(req);
}
