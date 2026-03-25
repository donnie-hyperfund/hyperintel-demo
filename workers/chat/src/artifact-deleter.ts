import { PublicError } from '@common/common/error.helpers';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactEmbeddingEntity } from '@/lib/orm/entities/artifacts/artifact-embedding.entity';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import type { DeleteArtifactDto } from '@/lib/schema/artifact';
import { UserEventType } from '@/lib/schema/user-events';
import type { Ctx } from './context';
import { broadcastUserEvent } from './utils/broadcast';

export async function deleteArtifactHandler(data: DeleteArtifactDto, ctx: Ctx) {
    const { artifactId } = data;
    const { em, user } = ctx;

    const artifact = await em
        .createQueryBuilder(ArtifactEntity, 'a')
        .select('a.*')
        .leftJoinAndSelect('a.project', 'p')
        .leftJoinAndSelect('p.user', 'pu')
        .leftJoinAndSelect('a.user', 'au')
        .leftJoinAndSelect('a.chat', 'c')
        .leftJoinAndSelect('c.user', 'cu')
        .where({
            'a.id': artifactId,
            $or: [{ 'pu.clerkId': user.userId }, { 'au.clerkId': user.userId }, { 'cu.clerkId': user.userId }],
        })
        .getSingleResult();

    if (!artifact) {
        throw new PublicError(404, {
            message: 'Artifact not found or access denied',
            code: 'ARTIFACT_NOT_FOUND',
        });
    }

    const files = await em.find(ArtifactFileEntity, {
        artifact_version: { artifact: artifactId },
    });
    const storageKeys = files.map((f) => f.storage_key);

    await em.transactional(async (txEm) => {
        await Promise.all([
            txEm.nativeDelete(ArtifactEmbeddingEntity, { artifact_version: { artifact: artifactId } }),
            txEm.nativeDelete(ArtifactFileEntity, { artifact_version: { artifact: artifactId } }),
        ]);
        await txEm.nativeDelete(ArtifactVersionEntity, { artifact: artifactId });
        await txEm.nativeDelete(ArtifactEntity, { id: artifactId });
    });

    // R2 cleanup after commit — best-effort (orphaned blobs are harmless)
    if (storageKeys.length > 0 && ctx.env.ARTIFACTS_BUCKET) {
        await Promise.allSettled(storageKeys.map((key) => ctx.env.ARTIFACTS_BUCKET.delete(key)));
    }

    const projectId = artifact.project?.id;
    if (projectId) {
        await broadcastUserEvent(ctx, UserEventType.ProjectResourceDeleted, { projectId, artifactId });
    }

    return { success: true, artifactId };
}
