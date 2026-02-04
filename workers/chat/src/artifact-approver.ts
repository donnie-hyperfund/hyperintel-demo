import { runInferenceNoStream, AIParamsType } from '@common/ai/inference/run-inference';
import { ANTHROPIC_MODELS } from '@common/ai/types/models';
import { PublicError } from '@common/common/error.helpers';
import { CloudflareQueueAdapter } from '@common/queue/embedding-queue.adapter';
import { getLangfusePromptRaw } from '@worker/vendor/langfuse-prompts';
import type { ApproveArtifactActionDto, RejectArtifactActionDto } from '@/lib/schema/artifact';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { Ctx } from './context';
import { shouldGenerateAiContent } from './tools/documents/document-classifier';

const YAML_GENERATION_MODEL = ANTHROPIC_MODELS.SONNET;
const YAML_PROMPT_SLUG = 'pma2/ai-content-prompt';

async function generateYAMLForArtifact(
    content: string,
    messages: ChatMessageEntity[],
    ctx: Ctx,
): Promise<string> {
    if (!ctx.langfuse) {
        throw new Error('Langfuse client not available');
    }

    const systemPrompt = await getLangfusePromptRaw(ctx.langfuse, YAML_PROMPT_SLUG);

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
): Promise<{ success: boolean; version: number; status: string; yamlGenerated: boolean }> {
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
        .leftJoinAndSelect('a.chat', 'c')
        .leftJoinAndSelect('a.project', 'p')
        .leftJoinAndSelect('p.user', 'u')
        .where({
            'v.id': versionId,
            'u.clerkId': user.userId,
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

    // Classify document to determine if AI-readable YAML should be generated
    const isInternalDocument = await shouldGenerateAiContent(
        ctx,
        version.artifact.key,
        version.artifact.title,
    );

    console.log('[approveArtifact] Document classification:', {
        documentKey: version.artifact.key,
        isInternalDocument,
    });

    let yamlContent: string | undefined;
    let yamlGenerated = false;

    // Only generate YAML for internal documents, not for client deliverables
    if (isInternalDocument) {
        const messages = await em.find(
            ChatMessageEntity,
            { chat: version.artifact.chat.id },
            { orderBy: { created_at: 'ASC' } },
        );

        try {
            yamlContent = await generateYAMLForArtifact(version.content, messages, ctx);
            yamlGenerated = true;
        } catch (error) {
            console.error('[approveArtifact] YAML generation failed:', error);
            yamlContent = `# YAML generation failed\n# Error: ${error instanceof Error ? error.message : String(error)}\n\n${version.content}`;
        }

        version.ai_content = yamlContent;
    } else {
        console.log('[approveArtifact] Skipping YAML generation for client deliverable:', version.artifact.key);
    }

    version.status = 'approved';
    version.status_changed_at = new Date();
    version.status_changed_by = version.artifact.project.user.id;
    version.artifact.current_version = version;

    await em.flush();

    if (ctx.env.EMBEDDING_QUEUE) {
        try {
            const embeddingQueue = new CloudflareQueueAdapter(ctx.env.EMBEDDING_QUEUE);

            // For internal documents: index AI-readable YAML
            // For client deliverables: index original content (no AI-readable version)
            await embeddingQueue.send({
                type: 'index_artifact_version',
                projectId: version.artifact.project.id,
                versionId: version.id,
                content: isInternalDocument && yamlContent ? yamlContent : version.content,
                documentName: version.artifact.key,
                is_ai_content: isInternalDocument,
            });
        } catch (err) {
            console.error('[approveArtifact] Embedding queue failed:', err);
        }
    }

    return {
        success: true,
        version: version.version,
        status: 'approved',
        yamlGenerated,
    };
}

export async function rejectArtifactHandler(
    data: RejectArtifactActionDto,
    ctx: Ctx,
): Promise<{ success: boolean; version: number; status: string; reason: string }> {
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
        .leftJoinAndSelect('a.project', 'p')
        .leftJoinAndSelect('p.user', 'u')
        .where({
            'v.id': versionId,
            'u.clerkId': user.userId,
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

    version.status = 'rejected';
    version.rejection_reason = reason;
    version.status_changed_at = new Date();
    version.status_changed_by = version.artifact.project.user.id;

    await em.flush();

    return {
        success: true,
        version: version.version,
        status: 'rejected',
        reason,
    };
}
