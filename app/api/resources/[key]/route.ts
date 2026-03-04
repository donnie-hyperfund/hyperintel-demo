import { type NextRequest, type NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleGetResourceByKey } from '@/lib/artifacts/handlers';

export function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { key } = await params;
        return await handleGetResourceByKey(request, key, user);
    })(req);
}
