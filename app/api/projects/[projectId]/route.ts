import type { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleDeleteProject, handleGetProject, handleUpdateProject } from '@/lib/projects/handlers';

type RouteParams = { projectId: string };

export function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }): Promise<NextResponse> {
    return withAuth(async (_request, user) => {
        const { projectId } = await params;
        return handleGetProject(projectId, user);
    })(req);
}

export function PATCH(req: NextRequest, { params }: { params: Promise<RouteParams> }): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return handleUpdateProject(request, projectId, user);
    })(req);
}

export function DELETE(req: NextRequest, { params }: { params: Promise<RouteParams> }): Promise<NextResponse> {
    return withAuth(async (_request, user) => {
        const { projectId } = await params;
        return handleDeleteProject(projectId, user);
    })(req);
}
