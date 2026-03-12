import { auth, currentUser } from '@clerk/nextjs/server';
import type { EntityManager } from '@mikro-orm/postgresql';
import { redirect } from 'next/navigation';
import { type NextRequest, NextResponse } from 'next/server';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import type { ClerkUser } from '@/lib/types/clerk';

type AuthenticatedHandler = (req: NextRequest, user: UserEntity) => Promise<NextResponse> | NextResponse;

/**
 * Find or create a UserEntity for a Clerk-authenticated user.
 * Covers the race where signup completes before the Clerk webhook fires.
 */
async function ensureUser(clerkId: string, em: EntityManager): Promise<UserEntity> {
    const existing = await em.findOne(UserEntity, { clerkId });
    if (existing) return existing;

    const clerkUser = await currentUser();

    const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? `${clerkId}@placeholder.com`;
    const firstName = clerkUser?.firstName;
    const lastName = clerkUser?.lastName;
    const name = firstName && lastName ? `${firstName} ${lastName}` : (firstName ?? lastName ?? null);

    const user = await em.upsert(UserEntity, {
        clerkId,
        email,
        name,
        emailConfirmed: false,
    });
    await em.flush();
    return user;
}

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
    return ensureUser(userId, em);
}

/**
 * Same as assertAuth() but redirects to sign-in instead of throwing.
 * Use in server component layouts/pages where an unhandled throw crashes the page.
 */
export async function assertAuthPage(): Promise<UserEntity> {
    try {
        return await assertAuth();
    } catch {
        redirect('/sign-in');
    }
}

export function withAuth(handler: AuthenticatedHandler) {
    return async (req: NextRequest): Promise<NextResponse> => {
        const { userId } = await auth();

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
        }

        const { em } = await getOrm();
        const user = await ensureUser(userId, em);

        return handler(req, user);
    };
}
