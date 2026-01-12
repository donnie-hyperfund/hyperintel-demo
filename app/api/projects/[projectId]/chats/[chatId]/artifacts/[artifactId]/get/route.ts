import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { getOrm } from '@/lib/orm/orm';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ARTIFACT_ERRORS } from '../../errors';
import type { ArtifactResponseDto } from '../../schemas';

async function handleGetArtifact(
    req: NextRequest,
    projectId: string,
    chatId: string,
    artifactId: string,
    user: UserEntity,
): Promise<NextResponse> {
    const { em } = await getOrm();

    const artifact = await em.createQueryBuilder(ArtifactEntity, 'a')
        .select('a')
        .leftJoinAndSelect('a.currentVersion', 'cv')
        .leftJoin('a.chat', 'c')
        .leftJoin('a.project', 'p')
        .where({
            'a.id': artifactId,
            'c.id': chatId,
            'p.id': projectId,
            'p.user': user.id,
        })
        .getSingleResult();

    if (!artifact) {
        return ARTIFACT_ERRORS.ARTIFACT_NOT_FOUND;
    }

    const response: ArtifactResponseDto = {
        id: artifact.id,
        key: artifact.key,
        title: artifact.title,
        version: artifact.version,
        chatId: artifact.chat.id,
        projectId: artifact.project.id,
        currentVersion: {
            id: artifact.currentVersion.id,
            version: artifact.currentVersion.version,
            content: artifact.currentVersion.content,
            createdAt: artifact.currentVersion.created_at.toISOString(),
        },
        metadata: artifact.metadata ?? null,
        createdAt: artifact.created_at.toISOString(),
        updatedAt: artifact.updated_at.toISOString(),
    };

    return NextResponse.json(response);
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; chatId: string; artifactId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId, chatId, artifactId } = await params;
        return await handleGetArtifact(request, projectId, chatId, artifactId, user);
    })(req);
}

