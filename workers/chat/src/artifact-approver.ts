import { AIParamsType, runInferenceNoStream } from '@common/ai/inference/run-inference';
import { ANTHROPIC_MODELS } from '@common/ai/types/models';
import { PublicError } from '@common/common/error.helpers';
import { publishArtifactToUserScope } from '@/lib/artifacts/publish';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { ApproveArtifactActionDto, RejectArtifactActionDto } from '@/lib/schema/artifact';
import { PUBLISHABLE_DOCUMENT_TYPES } from '@/lib/schema/artifact';
import type { ArtifactProcessingStage } from '@/lib/schema/user-events';
import { Ctx } from './context';
import { shouldGenerateAiContent } from './tools/documents/document-classifier';
import { broadcastUserEvent, getUserGatewayStub } from './utils/broadcast';
import { getPromptContent, resolveLocalPromptPath } from './utils/prompt-loader';
import { injectSystemEvent } from './utils/system-events';

const YAML_GENERATION_MODEL = ANTHROPIC_MODELS.SONNET;
const YAML_PROMPT_SLUG = 'pma2/ai-content-prompt';

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

async function generateYAMLForArtifact(content: string, messages: ChatMessageEntity[], ctx: Ctx): Promise<string> {
    const localPath = resolveLocalPromptPath();
    const systemPrompt = await getPromptContent(ctx, YAML_PROMPT_SLUG, localPath);
    if (!systemPrompt) {
        throw new Error(`Failed to load prompt: ${YAML_PROMPT_SLUG}`);
    }

    const conversationContext = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
    }));

    const result = await runInferenceNoStream(ctx, {
        paramsType: AIParamsType.Anthropic,
        params: {
            model: YAML_GENERATION_MODEL,
            maxTokens: 4000,
        },
        instructions: systemPrompt,
        context: [
            ...conversationContext,
            {
                role: 'user',
                content: `Now, analyze this document and generate the YAML specification:\n\n${content}`,
            },
        ],
    });

    if (result.status !== 'success') {
        throw new Error(`YAML generation failed: ${result.status}`);
    }

    let yamlContent = result.result.trim();

    yamlContent = yamlContent.replace(/^```ya?ml\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    return yamlContent;
}

export async function approveArtifactHandler(
    data: ApproveArtifactActionDto,
    ctx: Ctx,
): Promise<{
    success: boolean;
    version: number;
    status: string;
    yamlGenerated: boolean;
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

    await broadcastArtifactProgress({
        ctx,
        version,
        action: 'approve',
        previousStatus,
        stage: 'classifying',
        progress: 10,
    });

    // Classify document to determine if AI-readable YAML should be generated
    const isInternalDocument = await shouldGenerateAiContent(ctx, version.artifact.key, version.title);

    console.log('[approveArtifact] Document classification:', {
        documentKey: version.artifact.key,
        isInternalDocument,
    });

    let yamlContent: string | undefined;
    let yamlGenerated = false;
    const documentContent = version.content ?? '';

    // Only generate YAML for internal documents, not for client deliverables
    if (isInternalDocument) {
        await broadcastArtifactProgress({
            ctx,
            version,
            action: 'approve',
            previousStatus,
            stage: 'generating-ai-content',
            progress: 24,
        });

        const messages = await em.find(
            ChatMessageEntity,
            { chat: version.chat.id },
            { orderBy: { created_at: 'ASC' } },
        );

        try {
            yamlContent = await generateYAMLForArtifact(documentContent, messages, ctx);
            yamlGenerated = true;
        } catch (error) {
            console.error('[approveArtifact] YAML generation failed:', error);
            yamlContent = `# YAML generation failed\n# Error: ${error instanceof Error ? error.message : String(error)}\n\n${documentContent}`;
        }

        version.ai_content = yamlContent;
    } else {
        console.log('[approveArtifact] Skipping YAML generation for client deliverable:', version.artifact.key);
    }

    await broadcastArtifactProgress({
        ctx,
        version,
        action: 'approve',
        previousStatus,
        stage: 'saving',
        progress: isInternalDocument ? 76 : 62,
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
            // For internal documents: index AI-readable YAML
            // For client deliverables: index original content (no AI-readable version)
            await ctx.env.EMBEDDING_QUEUE.send({
                type: 'index_artifact_version',
                projectId: project.id,
                versionId: version.id,
                content: isInternalDocument && yamlContent ? yamlContent : documentContent,
                documentName: version.artifact.key,
                is_ai_content: isInternalDocument,
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
        yamlGenerated,
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
