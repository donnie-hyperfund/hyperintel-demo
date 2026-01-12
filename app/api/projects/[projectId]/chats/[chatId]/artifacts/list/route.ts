import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { getPaginatedResult, createPaginatedResponse } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { ListArtifactsQuerySchema, type ArtifactResponseDto } from '../schemas';

async function handleGetArtifacts(
    req: NextRequest,
    projectId: string,
    chatId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListArtifactsQuerySchema, {
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
    });

    if (queryData instanceof NextResponse) return queryData;

    const query = em.createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.chat', 'c')
        .leftJoin('a.project', 'p')
        .leftJoin('a.currentVersion', 'cv')
        .where({
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .orderBy({ 'a.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(
        query,
        {
            page: queryData.page ?? 1,
            perPage: queryData.limit ?? 20,
        },
    );

    const responseData: ArtifactResponseDto[] = nodes.map((artifact: any) => ({
        id: artifact.id,
        key: artifact.key,
        title: artifact.title,
        version: artifact.version,
        chatId: artifact.chat_id,
        projectId: artifact.project_id,
        currentVersion: {
            id: artifact.current_version_id,
            version: artifact.version,
            content: '',
            createdAt: new Date(artifact.created_at).toISOString(),
        },
        metadata: artifact.metadata || null,
        createdAt: new Date(artifact.created_at).toISOString(),
        updatedAt: new Date(artifact.updated_at).toISOString(),
    }));

    return NextResponse.json(
        createPaginatedResponse(
            responseData,
            totalCount,
            queryData.page ?? 1,
            queryData.limit ?? 20,
        ),
    );
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, chatId } = await params;
        return await handleGetArtifacts(request, projectId, chatId, user);
    })(req);
}

