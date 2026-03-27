import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleGetUserVersions } from '@/lib/artifacts/handlers';

export function GET(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => {
        return handleGetUserVersions(request, user.id);
    })(req);
}
