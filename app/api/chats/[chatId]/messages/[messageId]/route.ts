import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { IS_DEV } from '@/lib/config';
import { handleGetMessage, handleSetMessageFeedback } from '@/lib/chats/handlers';
import { SetMessageFeedbackBodySchema } from '@/lib/schema/message';

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
        const parsed = SetMessageFeedbackBodySchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid request body', details: parsed.error.flatten() },
                { status: 400 },
            );
        }
        return handleSetMessageFeedback(chatId, messageId, user, parsed.data);
    })(req);
}
