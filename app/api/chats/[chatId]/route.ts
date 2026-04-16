import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleDeleteChat, handleGetChat, handleUpdateChatName } from '@/lib/chats/handlers';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (_request, user) => {
        const { chatId } = await params;
        return handleGetChat(chatId, user);
    })(req);
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { chatId } = await params;
        return handleUpdateChatName(request, chatId, user);
    })(req);
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (_request, user) => {
        const { chatId } = await params;
        return handleDeleteChat(chatId, user);
    })(req);
}
