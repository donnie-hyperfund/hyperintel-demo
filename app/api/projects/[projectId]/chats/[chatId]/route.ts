import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleDeleteChat, handleGetChat } from '@/lib/chats/handlers';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (_request, user) => {
        const { projectId, chatId } = await params;
        return handleGetChat(chatId, user, projectId);
    })(req);
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (_request, user) => {
        const { projectId, chatId } = await params;
        return handleDeleteChat(chatId, user, projectId);
    })(req);
}
