import { COMMON_ERRORS } from '@/common/common/common.constants';
import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { ClerkUser } from '../types/clerk';

export async function assertAuth(): Promise<ClerkUser> {
    const { userId, sessionClaims, sessionId, isAuthenticated } = await auth();

    if (!userId || !isAuthenticated) {
        throw COMMON_ERRORS.UNAUTHORIZED;
    }

    return { userId, sessionClaims, sessionId };
}

export async function getAuth(): Promise<ClerkUser | null> {
    const { userId, sessionClaims, sessionId, isAuthenticated } = await auth();

    if (!userId || !isAuthenticated) {
        return null;
    }

    return { userId, sessionClaims, sessionId };
}

export async function requireAuth(): Promise<ClerkUser | NextResponse> {
    const { userId, sessionClaims, sessionId, isAuthenticated } = await auth();

    if (!userId || !isAuthenticated) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return { userId, sessionClaims, sessionId };
}

export function withAuth(handler: (req: NextRequest, user: ClerkUser) => Promise<NextResponse<unknown>>) {
    return async (req: NextRequest): Promise<NextResponse<unknown>> => {
        const authResult = await requireAuth();
        if (authResult instanceof NextResponse) {
            return authResult;
        }
        return handler(req, authResult);
    };
}
