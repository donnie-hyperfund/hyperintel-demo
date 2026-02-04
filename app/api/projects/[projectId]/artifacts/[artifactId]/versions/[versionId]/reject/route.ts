import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/auth-guard';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';

const ERRORS = {
    VERSION_NOT_FOUND: NextResponse.json(
        { error: 'Version not found', code: 'VERSION_NOT_FOUND' },
        { status: 404 },
    ),
    INVALID_STATUS: (status: string) =>
        NextResponse.json(
            { error: `Cannot reject version with status '${status}'`, code: 'INVALID_STATUS' },
            { status: 400 },
        ),
    INVALID_BODY: (message: string) =>
        NextResponse.json(
            { error: message, code: 'INVALID_BODY' },
            { status: 400 },
        ),
};

const RejectBodySchema = z.object({
    reason: z.string().min(1, 'Rejection reason is required'),
});

type RouteParams = { projectId: string; artifactId: string; versionId: string };

async function handleRejectVersion(
    req: NextRequest,
    { projectId, artifactId, versionId }: RouteParams,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    // Parse and validate body
    let body: z.infer<typeof RejectBodySchema>;
    try {
        const rawBody = await req.json();
        body = RejectBodySchema.parse(rawBody);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return ERRORS.INVALID_BODY(err.errors[0]?.message ?? 'Invalid request body');
        }
        return ERRORS.INVALID_BODY('Invalid JSON body');
    }

    // Find the version and verify ownership through project
    const version = await em
        .createQueryBuilder(ArtifactVersionEntity, 'v')
        .select('v.*')
        .leftJoinAndSelect('v.artifact', 'a')
        .leftJoin('a.project', 'p')
        .where({
            'v.id': versionId,
            'a.id': artifactId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .getSingleResult();

    if (!version) {
        return ERRORS.VERSION_NOT_FOUND;
    }

    if (version.status !== 'proposed') {
        return ERRORS.INVALID_STATUS(version.status);
    }

    // Reject the version
    version.status = 'rejected';
    version.rejection_reason = body.reason;
    version.status_changed_at = new Date();
    version.status_changed_by = user.id;

    await em.flush();

    return NextResponse.json({
        success: true,
        version: version.version,
        status: 'rejected',
        reason: body.reason,
    });
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<RouteParams> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const resolvedParams = await params;
        return await handleRejectVersion(request, resolvedParams, user);
    })(req);
}
