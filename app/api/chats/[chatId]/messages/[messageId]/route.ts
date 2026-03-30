import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { IS_DEV } from '@/lib/config';
import { handleGetMessage, handleSetMessageFeedback } from '@/lib/chats/handlers';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string; messageId: string }> },
): Promise<NextResponse> {
    return withAuth(async (_request, user) => {
        const { chatId, messageId } = await params;
        return handleGetMessage(chatId, messageId, user);
    })(req);
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string; messageId: string }> },
): Promise<NextResponse> {
    if (!IS_DEV) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return withAuth(async (_request, user) => {
        const { chatId, messageId } = await params;
        const body = await req.json();
        return handleSetMessageFeedback(chatId, messageId, user, body);
    })(req);
}
