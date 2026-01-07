import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';

export async function requireAuth(): Promise<{ userId: string } | NextResponse> {
    const { userId } = await auth();

    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return { userId };
}

export function withAuth(handler: (req: NextRequest, userId: string) => Promise<NextResponse<unknown>>) {
    return async (req: NextRequest): Promise<NextResponse<unknown>> => {
        const authResult = await requireAuth();
        if (authResult instanceof NextResponse) {
            return authResult;
        }
        return handler(req, authResult.userId);
    };
}
