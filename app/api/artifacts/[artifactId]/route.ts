import type { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleDeleteArtifact, handleGetArtifact } from '@/lib/artifacts/handlers';

type RouteParams = { artifactId: string };

export function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { artifactId } = await params;
        return handleGetArtifact(request, artifactId, user);
    })(req);
}

export function DELETE(req: NextRequest, { params }: { params: Promise<RouteParams> }): Promise<NextResponse> {
    return withAuth(async (_request, user) => {
        const { artifactId } = await params;
        return handleDeleteArtifact(artifactId, user);
    })(req);
}
