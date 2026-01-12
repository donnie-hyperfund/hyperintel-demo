import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';

type AuthenticatedHandler = (
    req: NextRequest,
    user: UserEntity,
) => Promise<NextResponse> | NextResponse;

export function withAuth(handler: AuthenticatedHandler) {
    return async (req: NextRequest): Promise<NextResponse> => {
        const { userId } = await auth();

        if (!userId) {
            return NextResponse.json(
                { error: 'Unauthorized', code: 'UNAUTHORIZED' },
                { status: 401 },
            );
        }

        const { em } = await getOrm();
        const user = await em.findOne(UserEntity, { clerkId: userId });

        if (!user) {
            return NextResponse.json(
                { error: 'User not found', code: 'USER_NOT_FOUND' },
                { status: 404 },
            );
        }

        return handler(req, user);
    };
}
