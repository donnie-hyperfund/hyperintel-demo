import type { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleImportArtifacts } from '@/lib/artifacts/handlers';

export function POST(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleImportArtifacts(request, user))(req);
}
