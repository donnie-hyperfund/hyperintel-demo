import { runInferenceNoStream, AIParamsType } from '@common/ai/inference/run-inference';
import { ANTHROPIC_MODELS } from '@common/ai/types/models';
import { PublicError } from '@common/common/error.helpers';
import { CloudflareQueueAdapter } from '@common/queue/embedding-queue.adapter';
import type { ApproveArtifactActionDto, RejectArtifactActionDto } from '@/lib/schema/artifact';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { Ctx } from './context';

const YAML_GENERATION_SYSTEM_PROMPT = `You are a document analyzer that generates structured YAML metadata.

Analyze the provided document and generate a YAML specification that describes it.

Requirements:
1. Generate ONLY valid YAML (no markdown code fences, no extra text)
2. Use the exact structure shown below
3. Extract key information from both document and conversation context
4. Be concise but informative
5. Ensure all YAML keys and values are properly formatted

Output Format:

document_specification:
  type: "<document type: requirements/design/analysis/specification/report>"
  title: "<document title>"
  summary: "<2-3 sentence summary>"
  key_attributes:
    audience: "<target audience>"
    purpose: "<primary purpose>"
    scope: "<what the document covers>"
  content_structure:
    sections:
      - name: "<section name>"
        summary: "<brief description>"
      - name: "<section name>"
        summary: "<brief description>"
    key_points:
      - "<important point 1>"
      - "<important point 2>"
      - "<important point 3>"
  metadata:
    conversation_context: "<how this document was created from the chat>"
    version: "1.0"

Generate the YAML now.`;

const YAML_GENERATION_MODEL = ANTHROPIC_MODELS.OPUS;

async function generateYAMLForArtifact(
    content: string,
    messages: ChatMessageEntity[],
    ctx: Ctx,
): Promise<string> {
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
        instructions: YAML_GENERATION_SYSTEM_PROMPT,
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
        .leftJoin('p.user', 'u')
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

    const messages = await em.find(
        ChatMessageEntity,
        { chat: version.artifact.chat.id },
        { orderBy: { created_at: 'ASC' } },
    );

    let yamlContent: string;
    let yamlGenerated = false;

    try {
        yamlContent = await generateYAMLForArtifact(version.content, messages, ctx);
        yamlGenerated = true;
    } catch (error) {
        console.error('[approveArtifact] YAML generation failed:', error);
        yamlContent = `# YAML generation failed\n# Error: ${error instanceof Error ? error.message : String(error)}\n\n${version.content}`;
    }

    version.ai_content = yamlContent;
    version.status = 'approved';
    version.status_changed_at = new Date();
    version.status_changed_by = user.userId;
    version.artifact.current_version = version;

    await em.flush();

    if (ctx.env.EMBEDDING_QUEUE) {
        try {
            const embeddingQueue = new CloudflareQueueAdapter(ctx.env.EMBEDDING_QUEUE);

            await embeddingQueue.send({
                type: 'index_artifact_version',
                projectId: version.artifact.project.id,
                versionId: version.id,
                content: version.ai_content,
                documentName: version.artifact.key,
                is_ai_content: true,
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
        .leftJoin('a.project', 'p')
        .leftJoin('p.user', 'u')
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
    version.status_changed_by = user.userId;

    await em.flush();

    return {
        success: true,
        version: version.version,
        status: 'rejected',
        reason,
    };
}
