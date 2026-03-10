import type { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { handleCreateProject, handleListProjects } from '@/lib/projects/handlers';

export function GET(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleListProjects(request, user))(req);
}

export function POST(req: NextRequest): Promise<NextResponse> {
    return withAuth((request, user) => handleCreateProject(request, user))(req);
}
