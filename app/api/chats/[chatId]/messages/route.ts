import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleCreateMessage, handleGetMessages } from '@/lib/chats/handlers';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { chatId } = await params;
        return handleGetMessages(request, chatId, user);
    })(req);
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { chatId } = await params;
        return handleCreateMessage(request, chatId, user);
    })(req);
}
