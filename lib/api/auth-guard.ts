import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import type { ClerkUser } from '@/lib/types/clerk';

type AuthenticatedHandler = (req: NextRequest, user: UserEntity) => Promise<NextResponse> | NextResponse;

/**
 * Returns ClerkUser shape for worker context compatibility.
 * Use this for local worker execution (e.g., initNextjsWorkerContext).
 */
export async function assertClerkAuth(): Promise<ClerkUser> {
    const { userId, sessionId, sessionClaims } = await auth();

    if (!userId) {
        throw new Error('Unauthorized');
    }

    return { userId, sessionId, sessionClaims };
}

/**
 * Returns UserEntity for API route handlers.
 * Use this when you need the full user entity with DB relations.
 */
export async function assertAuth(): Promise<UserEntity> {
    const { userId } = await auth();

    if (!userId) {
        throw new Error('Unauthorized');
    }

    const { em } = await getOrm();
    const user = await em.findOne(UserEntity, { clerkId: userId });

    if (!user) {
        throw new Error('User not found');
    }

    return user;
}

export function withAuth(handler: AuthenticatedHandler) {
    return async (req: NextRequest): Promise<NextResponse> => {
        const { userId } = await auth();

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
        }

        const { em } = await getOrm();
        const user = await em.findOne(UserEntity, { clerkId: userId });

        if (!user) {
            return NextResponse.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, { status: 404 });
        }

        return handler(req, user);
    };
}
