import { PublicError } from '@common/common/error.helpers';
import { publishArtifactToUserScope } from '@/lib/artifacts/publish';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import type { ApproveArtifactActionDto, RejectArtifactActionDto } from '@/lib/schema/artifact';
import { PUBLISHABLE_DOCUMENT_TYPES } from '@/lib/schema/artifact';
import type { ArtifactProcessingStage } from '@/lib/schema/user-events';
import { Ctx } from './context';
import { broadcastUserEvent, getUserGatewayStub } from './utils/broadcast';
import { injectSystemEvent } from './utils/system-events';

async function broadcastArtifactProgress({
    ctx,
    version,
    action,
    previousStatus,
    stage,
    progress,
}: {
    ctx: Ctx;
    version: ArtifactVersionEntity;
    action: 'approve' | 'reject';
    previousStatus: string;
    stage: Exclude<ArtifactProcessingStage, 'queued'>;
    progress: number;
}) {
    const project = version.artifact.project;
    const chat = version.chat;
    if (!chat) return;

    await broadcastUserEvent(ctx, 'artifact_version_update_progress', {
        artifactId: version.artifact.id,
        artifactName: version.artifact.key,
        versionId: version.id,
        version: version.version,
        action,
        previousStatus,
        stage,
        progress,
        projectName: project?.name,
        phaseName: chat.name ?? undefined,
        phaseIndex: chat.phase_index,
        chatId: chat.id,
    });
}

export async function approveArtifactHandler(
    data: ApproveArtifactActionDto,
    ctx: Ctx,
): Promise<{
    success: boolean;
    version: number;
    status: string;
    chatId: string;
    chatType: string;
}> {
    const { versionId } = data;
    const { em, user } = ctx;

    if (!em) {
        throw new PublicError(500, {
            message: 'Database connection not available',
            code: 'DATABASE_UNAVAILABLE',
        });
    }

    const version = await em
        .createQueryBuilder(ArtifactVersionEntity, 'v')
        .select('v.*')
        .leftJoinAndSelect('v.artifact', 'a')
        .leftJoinAndSelect('v.chat', 'c')
        .leftJoinAndSelect('a.project', 'p')
        .leftJoinAndSelect('p.user', 'pu')
        .leftJoinAndSelect('a.user', 'au')
        .where({
            'v.id': versionId,
            $or: [{ 'pu.clerkId': user.userId }, { 'au.clerkId': user.userId }],
        })
        .getSingleResult();

    if (!version) {
        throw new PublicError(404, {
            message: 'Version not found or access denied',
            code: 'VERSION_NOT_FOUND',
        });
    }

    if (version.status !== 'proposed') {
        throw new PublicError(400, {
            message: `Cannot approve version with status '${version.status}'`,
            code: 'INVALID_STATUS',
        });
    }

    if (!version.chat) {
        throw new PublicError(400, {
            message: 'Cannot approve artifacts without a chat context',
            code: 'NO_CHAT_CONTEXT',
        });
    }

    const previousStatus = version.status;
    const project = version.artifact.project;
    const chat = version.chat;

    await broadcastUserEvent(ctx, 'artifact_version_update_started', {
        artifactId: version.artifact.id,
        artifactName: version.artifact.key,
        versionId,
        version: version.version,
        action: 'approve',
        previousStatus,
        nextStatus: 'approved',
        projectName: project?.name,
        phaseName: chat.name ?? undefined,
        phaseIndex: chat.phase_index,
        chatId: chat.id,
    });

    const documentContent = version.content ?? '';

    await broadcastArtifactProgress({
        ctx,
        version,
        action: 'approve',
        previousStatus,
        stage: 'saving',
        progress: 40,
    });

    const projectUser = project?.user;

    version.status = 'approved';
    version.status_changed_at = new Date();
    version.status_changed_by = projectUser?.id ?? version.artifact.user?.id;
    version.artifact.current_version = version;

    // Update ChatEntity CB status if this is a Completion Brief
    if (version.document_type === 'Completion Brief') {
        const cbChat = await em.findOne(ChatEntity, { completion_brief: version.artifact.id });
        if (cbChat) {
            cbChat.completion_brief_status = 'approved';
        }
    }

    await em.flush();

    // Publish publishable document types to user scope for cross-project availability
    if (PUBLISHABLE_DOCUMENT_TYPES.includes(version.document_type) && project && projectUser) {
        await broadcastArtifactProgress({
            ctx,
            version,
            action: 'approve',
            previousStatus,
            stage: 'publishing',
            progress: 84,
        });

        try {
            const publishResult = await publishArtifactToUserScope(em, {
                sourceVersion: version,
                userId: projectUser.id,
                projectId: project.id,
                projectName: project.name,
            });
            console.log('[approveArtifact] Published to user scope:', publishResult);
        } catch (err) {
            console.error('[approveArtifact] Publish to user scope failed (non-fatal):', err);
        }
    }

    if (ctx.env.EMBEDDING_QUEUE && project) {
        await broadcastArtifactProgress({
            ctx,
            version,
            action: 'approve',
            previousStatus,
            stage: 'indexing',
            progress: 88,
        });

        try {
            await ctx.env.EMBEDDING_QUEUE.send({
                type: 'index_artifact_version',
                projectId: project.id,
                versionId: version.id,
                content: documentContent,
                documentName: version.artifact.key,
                previewAlias: ctx.previewAlias,
            });
        } catch (err) {
            console.error('[approveArtifact] Embedding queue failed:', err);
        }
    }

    await broadcastArtifactProgress({
        ctx,
        version,
        action: 'approve',
        previousStatus,
        stage: 'finalizing',
        progress: 94,
    });

    await broadcastUserEvent(ctx, 'artifact_version_updated', {
        artifactId: version.artifact.id,
        artifactName: version.artifact.key,
        versionId,
        version: version.version,
        action: 'approve',
        previousStatus,
        status: 'approved',
        projectName: project?.name,
        phaseName: chat.name ?? undefined,
        phaseIndex: chat.phase_index,
        chatId: chat.id,
    });

    // Broadcast CB status change via chat-scoped UG topic
    if (version.document_type === 'Completion Brief') {
        const chatId = version.chat.id;
        const ugStub = getUserGatewayStub(ctx);
        ugStub
            .systemAction(`chat:${chatId}`, 'cbStatusChanged', { status: 'approved' }, ctx.previewAlias ?? undefined)
            .catch((err) => console.error('[approveArtifact] CB status broadcast failed:', err));
    }

    // Inject system event so the agent knows the user approved via UI
    const chatId = version.chat.id;
    const chatType = version.chat.type ?? 'phase';
    await injectSystemEvent(ctx, em, {
        chatId,
        chatType,
        event: 'artifact_approved',
        description: `User has approved artifact [${version.artifact.key}] v${version.version}`,
        extra: {
            artifactId: version.artifact.id,
            artifactKey: version.artifact.key,
            versionId,
            versionNumber: version.version,
        },
    });

    return {
        success: true,
        version: version.version,
        status: 'approved',
        chatId,
        chatType,
    };
}

export async function rejectArtifactHandler(
    data: RejectArtifactActionDto,
    ctx: Ctx,
): Promise<{ success: boolean; version: number; status: string; reason: string; chatId: string; chatType: string }> {
    const { versionId, reason } = data;
    const { em, user } = ctx;

    if (!em) {
        throw new PublicError(500, {
            message: 'Database connection not available',
            code: 'DATABASE_UNAVAILABLE',
        });
    }

    const version = await em
        .createQueryBuilder(ArtifactVersionEntity, 'v')
        .select('v.*')
        .leftJoinAndSelect('v.artifact', 'a')
        .leftJoinAndSelect('v.chat', 'c')
        .leftJoinAndSelect('a.project', 'p')
        .leftJoinAndSelect('p.user', 'pu')
        .leftJoinAndSelect('a.user', 'au')
        .where({
            'v.id': versionId,
            $or: [{ 'pu.clerkId': user.userId }, { 'au.clerkId': user.userId }],
        })
        .getSingleResult();

    if (!version) {
        throw new PublicError(404, {
            message: 'Version not found or access denied',
            code: 'VERSION_NOT_FOUND',
        });
    }

    if (version.status !== 'proposed') {
        throw new PublicError(400, {
            message: `Cannot reject version with status '${version.status}'`,
            code: 'INVALID_STATUS',
        });
    }

    if (!version.chat) {
        throw new PublicError(400, {
            message: 'Cannot reject artifacts without a chat context',
            code: 'NO_CHAT_CONTEXT',
        });
    }

    const previousStatus = version.status;
    const project = version.artifact.project;
    const chat = version.chat;

    await broadcastUserEvent(ctx, 'artifact_version_update_started', {
        artifactId: version.artifact.id,
        artifactName: version.artifact.key,
        versionId,
        version: version.version,
        action: 'reject',
        previousStatus,
        nextStatus: 'rejected',
        projectName: project?.name,
        phaseName: chat.name ?? undefined,
        phaseIndex: chat.phase_index,
        chatId: chat.id,
    });

    version.status = 'rejected';
    version.rejection_reason = reason;
    version.status_changed_at = new Date();
    version.status_changed_by = project?.user?.id ?? version.artifact.user?.id;
    version.artifact.current_version = version;

    // Update ChatEntity CB status if this is a Completion Brief
    if (version.document_type === 'Completion Brief') {
        const cbChat = await em.findOne(ChatEntity, { completion_brief: version.artifact.id });
        if (cbChat) {
            cbChat.completion_brief_status = 'rejected';
        }
    }

    await em.flush();

    await broadcastUserEvent(ctx, 'artifact_version_updated', {
        artifactId: version.artifact.id,
        artifactName: version.artifact.key,
        versionId,
        version: version.version,
        action: 'reject',
        previousStatus,
        status: 'rejected',
        projectName: project?.name,
        phaseName: chat.name ?? undefined,
        phaseIndex: chat.phase_index,
        chatId: chat.id,
    });

    // Broadcast CB status change via chat-scoped UG topic
    if (version.document_type === 'Completion Brief') {
        const chatId = version.chat.id;
        const ugStub = getUserGatewayStub(ctx);
        ugStub
            .systemAction(`chat:${chatId}`, 'cbStatusChanged', { status: 'rejected' }, ctx.previewAlias ?? undefined)
            .catch((err) => console.error('[rejectArtifact] CB status broadcast failed:', err));
    }

    // Inject system event so the agent knows the user rejected via UI
    const chatId = chat.id;
    const chatType = chat.type ?? 'phase';
    await injectSystemEvent(ctx, em, {
        chatId,
        chatType,
        event: 'artifact_rejected',
        description: `User has rejected artifact [${version.artifact.key}] v${version.version}. Reason: ${reason}`,
        extra: {
            artifactId: version.artifact.id,
            artifactKey: version.artifact.key,
            versionId,
            versionNumber: version.version,
            reason,
        },
    });

    return {
        success: true,
        version: version.version,
        status: 'rejected',
        reason,
        chatId,
        chatType,
    };
}
