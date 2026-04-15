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

export async function associateUploadsHandler(data: AssociateUploadsDto, ctx: Ctx) {
    const { artifactIds, imageFileIds, chatId, projectId } = data;

    if (!chatId && !projectId) {
        throw new PublicError(400, {
            message: 'At least one of chatId or projectId is required',
            code: 'MISSING_SCOPE',
        });
    }

    const { dbUserId } = await resolveScope(ctx.em, ctx.user, projectId, chatId);

    // Images can only be associated with a chat — they're always chat-message attachments.
    const [associatedArtifacts, associatedImages] = await Promise.all([
        artifactIds?.length
            ? associateArtifactsInternal(ctx, dbUserId, { chatId, projectId }, artifactIds)
            : Promise.resolve(0),
        imageFileIds?.length && chatId
            ? associateImagesInternal(ctx.em, dbUserId, chatId, imageFileIds)
            : Promise.resolve(0),
    ]);

    return { associatedArtifacts, associatedImages };
}
