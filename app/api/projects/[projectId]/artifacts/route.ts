import { wrap } from '@mikro-orm/core';
import { type NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/auth-guard';
import { createPaginatedResponse, getPaginatedResult } from '@/lib/api/pagination';
import { validatePayload } from '@/lib/api/validation';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import { type ArtifactDto, ListArtifactsQuerySchema } from '@/lib/schema/artifact';

async function handleGetArtifacts(req: NextRequest, projectId: string, user: UserEntity): Promise<NextResponse> {
    const { em } = await getOrm();

    const { searchParams } = new URL(req.url);
    const queryData = validatePayload(ListArtifactsQuerySchema, {
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
        key: searchParams.get('key') ?? undefined,
        version: searchParams.get('version') ?? undefined,
    });

    if (queryData instanceof NextResponse) return queryData;

    // If key is provided, fetch single artifact by key
    if (queryData.key) {
        const normalizedKey = normalizeArtifactKey(queryData.key);
        const artifact = await em
            .createQueryBuilder(ArtifactEntity, 'a')
            .select('a.*')
            .leftJoin('a.project', 'p')
            .leftJoinAndSelect('a.current_version', 'cv')
            .where({
                'a.key': normalizedKey,
                'p.id': projectId,
                'p.user': user.id,
            })
            .getSingleResult();

        if (!artifact) {
            return NextResponse.json({ error: 'Artifact not found', code: 'ARTIFACT_NOT_FOUND' }, { status: 404 });
        }

        // If specific version requested, use it as proposed and version-1 as current (for diffing)
        if (queryData.version !== undefined) {
            const requestedVersion = await em.findOne(ArtifactVersionEntity, {
                artifact: artifact.id,
                version: queryData.version,
            });
            if (!requestedVersion) {
                return NextResponse.json({ error: 'Version not found', code: 'VERSION_NOT_FOUND' }, { status: 404 });
            }

            // Fetch previous version for diff comparison (undefined if version is 1)
            const previousVersion =
                queryData.version > 1
                    ? await em.findOne(ArtifactVersionEntity, {
                          artifact: artifact.id,
                          version: queryData.version - 1,
                      })
                    : null;

            const dto: ArtifactDto = {
                ...wrap(artifact).toJSON(),
                current_version: previousVersion ? wrap(previousVersion).toJSON() : undefined,
                proposed_version: wrap(requestedVersion).toJSON(),
            };
            return NextResponse.json(dto);
        }

        // Default: fetch actual current and proposed versions
        const proposedVersion = await em.findOne(ArtifactVersionEntity, {
            artifact: artifact.id,
            status: 'proposed',
        });

        const dto: ArtifactDto = {
            ...wrap(artifact).toJSON(),
            proposed_version: proposedVersion ? wrap(proposedVersion).toJSON() : undefined,
        };
        return NextResponse.json(dto);
    }

    const query = em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoin('a.project', 'p')
        .leftJoinAndSelect('a.current_version', 'cv')
        .where({
            'p.id': projectId,
            'p.user': user.id,
        })
        .orderBy({ 'a.created_at': 'DESC' });

    const { nodes, totalCount } = await getPaginatedResult(query, {
        page: queryData.page ?? 1,
        perPage: queryData.limit ?? 20,
    });

    // Batch load proposed versions for all artifacts
    const artifactIds = nodes.map((a: ArtifactEntity) => a.id);
    const proposedVersions = artifactIds.length
        ? await em.find(ArtifactVersionEntity, {
              artifact: { $in: artifactIds },
              status: 'proposed',
          })
        : [];
    const proposedByArtifact = new Map(proposedVersions.map((v) => [v.artifact.id, v]));

    const mappedNodes = nodes.map((artifact: ArtifactEntity): ArtifactDto => {
        const proposed = proposedByArtifact.get(artifact.id);
        return {
            ...wrap(artifact).toJSON(),
            proposed_version: proposed ? wrap(proposed).toJSON() : undefined,
        };
    });

    return NextResponse.json(
        createPaginatedResponse(mappedNodes, totalCount, queryData.page ?? 1, queryData.limit ?? 20),
    );
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
    return withAuth(async (request, user) => {
        const { projectId } = await params;
        return await handleGetArtifacts(request, projectId, user);
    })(req);
}
