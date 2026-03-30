import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleUpdateChatModel } from '@/lib/chats/handlers';

export async function PATCH(
	req: NextRequest,
	{ params }: { params: Promise<{ chatId: string }> },
): Promise<NextResponse> {
	return withAuth(async (request, user) => {
		const { chatId } = await params;
		return handleUpdateChatModel(request, chatId, user);
	})(req);
}
