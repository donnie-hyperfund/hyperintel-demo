import type { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleCreateChat, handleListChats } from '@/lib/chats/handlers';

export function GET(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleListChats(request, user))(req);
}

export function POST(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleCreateChat(request, user))(req);
}
