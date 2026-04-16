/**
 * Orchestrator for /uploads/associate.
 * Resolves scope once, then fans out to the artifact and image pipelines.
 * Keeps the two upload domains separate while exposing a single endpoint to the client.
 */

import { PublicError } from '@common/common/error.helpers';
import type { AssociateUploadsDto } from '@/lib/schema/artifact';
import type { Ctx } from '../context';
import { associateArtifactsInternal } from './artifact-uploader';
import { associateImagesInternal } from './image-uploader';
import { resolveScope } from './scope';

type AssociationDomain = 'artifacts' | 'images';

export interface AssociateUploadsResult {
    associatedArtifacts: number;
    associatedImages: number;
}

export async function associateUploadsHandler(
    data: AssociateUploadsDto,
    ctx: Ctx,
): Promise<AssociateUploadsResult> {
    const { artifactIds, imageFileIds, chatId, projectId } = data;

    if (!chatId && !projectId) {
        throw new PublicError(400, {
            message: 'At least one of chatId or projectId is required',
            code: 'MISSING_SCOPE',
        });
    }

    const { dbUserId } = await resolveScope(ctx.em, ctx.user, projectId, chatId);

    // Images can only be associated with a chat — they're always chat-message attachments.
    // allSettled (not Promise.all) so one domain's failure doesn't abort the other mid-flush —
    // that way partial progress still lands on disk. BUT we then surface ANY failure as non-2xx:
    // the existing client only checks response.ok, and silently dropping half the uploads would
    // recreate the exact bug we built this endpoint to fix. Fail loud; retry is idempotent.
    const [artifactOutcome, imageOutcome] = await Promise.allSettled([
        artifactIds?.length
            ? associateArtifactsInternal(ctx, dbUserId, { chatId, projectId }, artifactIds)
            : Promise.resolve(0),
        imageFileIds?.length && chatId
            ? associateImagesInternal(ctx.em, dbUserId, chatId, imageFileIds)
            : Promise.resolve(0),
    ]);

    const errors: Array<{ domain: AssociationDomain; message: string }> = [];
    const associatedArtifacts =
        artifactOutcome.status === 'fulfilled' ? artifactOutcome.value : 0;
    const associatedImages = imageOutcome.status === 'fulfilled' ? imageOutcome.value : 0;

    if (artifactOutcome.status === 'rejected') {
        const message =
            artifactOutcome.reason instanceof Error
                ? artifactOutcome.reason.message
                : String(artifactOutcome.reason);
        console.error('[associate-handler] Artifact association failed:', artifactOutcome.reason);
        errors.push({ domain: 'artifacts', message });
    }

    if (imageOutcome.status === 'rejected') {
        const message =
            imageOutcome.reason instanceof Error
                ? imageOutcome.reason.message
                : String(imageOutcome.reason);
        console.error('[associate-handler] Image association failed:', imageOutcome.reason);
        errors.push({ domain: 'images', message });
    }

    // ANY failure → non-2xx. Details carry the partial successes so operators (and any future
    // error-aware client) can see exactly what landed before the failure.
    if (errors.length) {
        const bothFailed = errors.length === 2;
        throw new PublicError(bothFailed ? 500 : 502, {
            message: bothFailed
                ? 'Association failed for both artifacts and images'
                : `Association partially failed: ${errors.map((e) => e.domain).join(', ')}`,
            code: 'ASSOCIATE_FAILED',
            details: { errors, associatedArtifacts, associatedImages },
        });
    }

    return { associatedArtifacts, associatedImages };
}
