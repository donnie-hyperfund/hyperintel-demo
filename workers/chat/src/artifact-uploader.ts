import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PublicError } from '@common/common/error.helpers';
import { raw } from '@mikro-orm/core';
import { ExtractionQueueAdapter } from '@/lib/api/client/queue/extraction-queue.adapter';
import { normalizeUploadedFileKey, UPLOAD_ERROR_CODES, validateArtifactFile } from '@/lib/artifacts/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactFileEntity } from '@/lib/orm/entities/artifacts/artifact-file.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import {
    type AssociateArtifactsDto,
    type ConfirmUploadDto,
    isBinaryArtifactExtension,
    type PresignUploadDto,
    type UploadArtifactDto,
} from '@/lib/schema/artifact';
import { type ProjectResourceUploadUpdatedPayload, UserEventType } from '@/lib/schema/user-events';
import { createWorkerS3Client } from '@/lib/vendor/r2';
import type { Ctx } from './context';
import { broadcastUserEvent } from './utils/broadcast';

function getExtension(filename: string): string {
    return filename.slice(filename.lastIndexOf('.')).toLowerCase();
}

function buildStorageKey(
    versionId: string,
    filename: string,
    scopeId: { projectId?: string; chatId?: string; userId?: string },
): string {
    const scope = scopeId.projectId
        ? `project/${scopeId.projectId}`
        : scopeId.chatId
          ? `chat/${scopeId.chatId}`
          : `staged/${scopeId.userId}`;
    const ext = getExtension(filename);
    return `uploads/${scope}/${versionId}/${crypto.randomUUID()}${ext}`;
}

const MIME_TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const PRESIGN_EXPIRY_SECONDS = 60 * 10;

function extractTextFromRtf(content: string): string {
    // Lightweight RTF-to-text pass for common clipboard/exported files.
    return content
        .replace(/\\par[d]?/g, '\n')
        .replace(/\\tab/g, '\t')
        .replace(/\\'[0-9a-fA-F]{2}/g, (match) => String.fromCharCode(Number.parseInt(match.slice(2), 16)))
        .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
        .replace(/[{}]/g, '')
        .replace(/\\~/g, ' ')
        .replace(/\\\\/g, '\\')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function stripBomAndNullBytes(text: string): string {
    // Remove BOM (UTF-8/UTF-16 LE/BE) and null bytes which PostgreSQL text columns reject
    return text.replace(/^\uFEFF/, '').replace(/\0/g, '');
}

function normalizeTextUploadContent(filename: string, content: string): string {
    const cleaned = stripBomAndNullBytes(content);
    const ext = getExtension(filename);
    if (ext !== '.rtf') return cleaned;

    const extracted = extractTextFromRtf(cleaned);
    return extracted || cleaned;
}

function getBucketName(env: Env): string {
    return env.ENV === 'dev' ? 'hi-artifacts-dev' : 'hi-artifacts';
}

interface UpsertInput {
    normalizedKey: string;
    title: string;
    status: 'approved' | 'proposed';
    content?: string;
    projectId?: string;
    chatId?: string;
    userId?: string;
}

interface UpsertResult {
    action: 'created' | 'new_version';
    artifactId: string;
    versionId: string;
    version: number;
    supersededVersion?: number;
}

interface ResolvedScope {
    project?: InstanceType<typeof ProjectEntity> | null;
    dbUserId: string;
}

async function resolveScope(
    em: Ctx['em'],
    user: Ctx['user'],
    projectId?: string,
    chatId?: string,
): Promise<ResolvedScope> {
    let project: InstanceType<typeof ProjectEntity> | null = null;

    if (projectId) {
        project = await em.findOneOrFail(
            ProjectEntity,
            {
                id: projectId,
                user: { clerkId: user.userId },
                archived_at: null,
            },
            { populate: ['user'] },
        );
        if (chatId) {
            await em.findOneOrFail(ChatEntity, { id: chatId, project: projectId });
        }
        return { project, dbUserId: project.user.id };
    }

    if (chatId) {
        const chat = await em.findOneOrFail(
            ChatEntity,
            {
                id: chatId,
                type: 'intake',
                user: { clerkId: user.userId },
            },
            { populate: ['user'] },
        );
        return { dbUserId: chat.user!.id };
    }

    // Staged upload — no project or chat, resolve user directly
    const dbUser = await em.findOneOrFail(UserEntity, { clerkId: user.userId });
    return { dbUserId: dbUser.id };
}

async function upsertArtifactVersion(em: Ctx['em'], input: UpsertInput): Promise<UpsertResult> {
    const { normalizedKey, title, status, content, projectId, chatId, userId } = input;
    const statusChangedBy = projectId ?? chatId;
    const isStaged = !projectId && !chatId;

    // Staged uploads skip upsert — always create fresh (no user_id set, so no unique constraint hit)
    const scopeFilter = isStaged
        ? null
        : projectId
          ? { project: projectId, key: normalizedKey }
          : { chat: chatId, key: normalizedKey, project: null };

    const existing = scopeFilter
        ? await em.findOne(ArtifactEntity, scopeFilter, { populate: ['current_version', 'versions'] })
        : null;

    if (existing) {
        const versions = existing.versions.getItems();
        const newVersionNum = Math.max(...versions.map((v) => v.version), 0) + 1;

        const existingProposed = versions.find((v) => v.status === 'proposed');
        const supersededVersion = existingProposed?.version;

        if (existingProposed) {
            existingProposed.status = 'superseded';
            existingProposed.rejection_reason = `Superseded by uploaded v${newVersionNum}`;
            existingProposed.status_changed_at = new Date();
        }

        const newVersion = new ArtifactVersionEntity();
        newVersion.artifact = existing;
        newVersion.version = newVersionNum;
        newVersion.content = content;
        newVersion.status = status;
        newVersion.is_internal = false;
        newVersion.is_uploaded = true;
        newVersion.status_changed_at = new Date();
        newVersion.status_changed_by = statusChangedBy;
        if (chatId) newVersion.chat = em.getReference('ChatEntity', chatId) as any;

        em.persist(newVersion);
        existing.version = newVersionNum;
        existing.title = title;
        if (status === 'approved') existing.current_version = newVersion;

        await em.flush();

        return {
            action: 'new_version',
            artifactId: existing.id,
            versionId: newVersion.id,
            version: newVersionNum,
            supersededVersion,
        };
    }

    const result: UpsertResult = { action: 'created', artifactId: '', versionId: '', version: 1 };

    await em.transactional(async (txEm) => {
        const artifact = new ArtifactEntity();
        artifact.key = normalizedKey;
        artifact.title = title;
        artifact.version = 1;
        if (projectId) artifact.project = txEm.getReference('ProjectEntity', projectId) as any;
        if (chatId) artifact.chat = txEm.getReference('ChatEntity', chatId) as any;
        if (isStaged) {
            // No user_id — avoids unique constraint (user_id, key). Ownership tracked via metadata.
            artifact.metadata = { stagedBy: userId };
        } else if (userId) {
            artifact.user = txEm.getReference('UserEntity', userId) as any;
        }

        txEm.persist(artifact);
        await txEm.flush();

        const version = new ArtifactVersionEntity();
        version.artifact = artifact;
        version.version = 1;
        version.content = content;
        version.status = status;
        version.is_internal = false;
        version.is_uploaded = true;
        version.status_changed_at = new Date();
        version.status_changed_by = statusChangedBy;
        if (chatId) version.chat = txEm.getReference('ChatEntity', chatId) as any;

        txEm.persist(version);
        await txEm.flush();

        if (status === 'approved') {
            artifact.current_version = version;
            await txEm.flush();
        }

        result.artifactId = artifact.id;
        result.versionId = version.id;
    });

    return result;
}

function broadcastArtifactCreated(ctx: Ctx, result: UpsertResult, normalizedKey: string) {
    return broadcastUserEvent(ctx, 'artifact_version_created', {
        artifactId: result.artifactId,
        versionId: result.versionId,
        version: result.version,
        artifactName: normalizedKey,
    });
}

function broadcastProjectResourceUploadUpdated(ctx: Ctx, payload: ProjectResourceUploadUpdatedPayload) {
    return broadcastUserEvent(ctx, UserEventType.ProjectResourceUploadUpdated, payload);
}

export async function uploadArtifactHandler(data: UploadArtifactDto, ctx: Ctx) {
    const { file, projectId, chatId, title: titleInput, clientEntryId, source } = data;
    const { em, user } = ctx;

    const validation = validateArtifactFile(file);
    if (validation) {
        throw new PublicError(400, { message: validation.message, code: validation.code });
    }

    const rawContent = await file.text();
    const content = normalizeTextUploadContent(file.name, rawContent);
    if (!content.trim()) {
        throw new PublicError(400, {
            message: 'The uploaded file has no content',
            code: UPLOAD_ERROR_CODES.EMPTY_FILE,
        });
    }

    const title = titleInput || file.name.replace(/\.[^.]+$/, '');
    const normalizedKey = normalizeUploadedFileKey(file.name);
    const isStaged = !projectId && !chatId;

    const { dbUserId } = await resolveScope(em, user, projectId, chatId);

    const result = await upsertArtifactVersion(em, {
        normalizedKey,
        title,
        status: 'approved',
        content,
        projectId,
        chatId,
        userId: isStaged ? dbUserId : undefined,
    });

    // Only queue embedding when we have a scope — staged uploads defer embedding until association
    if (!isStaged) {
        await queueEmbedding(ctx, result.versionId, content, normalizedKey, projectId, chatId);
    }

    broadcastArtifactCreated(ctx, result, normalizedKey);
    if (projectId && source === 'project-resources') {
        broadcastProjectResourceUploadUpdated(ctx, {
            projectId,
            entryId: clientEntryId ?? result.artifactId,
            artifactId: result.artifactId,
            name: file.name,
            size: file.size,
            status: 'ready',
        });
    }

    return { success: true, ...result, key: normalizedKey };
}

export async function presignUploadHandler(data: PresignUploadDto, ctx: Ctx) {
    const { filename, fileSize, projectId, chatId, title: titleInput, clientEntryId, source } = data;
    const { em, user } = ctx;

    const ext = getExtension(filename);
    if (!isBinaryArtifactExtension(ext)) {
        throw new PublicError(400, {
            message: 'Only binary files (.pdf, .docx, .pptx) use the presign flow. Text files use /artifacts/upload.',
            code: 'TEXT_FILE_NOT_ALLOWED',
        });
    }

    const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const title = titleInput || filename.replace(/\.[^.]+$/, '');
    const normalizedKey = normalizeUploadedFileKey(filename);
    const isStaged = !projectId && !chatId;

    const { dbUserId } = await resolveScope(em, user, projectId, chatId);

    const result = await upsertArtifactVersion(em, {
        normalizedKey,
        title,
        status: 'proposed',
        projectId,
        chatId,
        userId: isStaged ? dbUserId : undefined,
    });

    // Create artifact_file record
    const storageKey = buildStorageKey(result.versionId, filename, { projectId, chatId, userId: dbUserId });

    const artifactFile = new ArtifactFileEntity();
    artifactFile.artifact_version = em.getReference('ArtifactVersionEntity', result.versionId) as any;
    artifactFile.storage_key = storageKey;
    artifactFile.original_name = filename;
    artifactFile.mime_type = mimeType;
    artifactFile.size_bytes = fileSize;
    artifactFile.status = 'pending_upload';

    em.persist(artifactFile);
    await em.flush();

    // Generate presigned PUT URL
    const s3 = await createWorkerS3Client(ctx.env);
    const command = new PutObjectCommand({
        Bucket: getBucketName(ctx.env),
        Key: storageKey,
        ContentType: mimeType,
        ContentLength: fileSize,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });

    broadcastArtifactCreated(ctx, result, normalizedKey);
    if (projectId && source === 'project-resources') {
        broadcastProjectResourceUploadUpdated(ctx, {
            projectId,
            entryId: clientEntryId ?? result.artifactId,
            artifactId: result.artifactId,
            fileId: artifactFile.id,
            name: filename,
            size: fileSize,
            status: 'uploading',
        });
    }

    return {
        uploadUrl,
        storageKey,
        fileId: artifactFile.id,
        key: normalizedKey,
        ...result,
    };
}

export async function confirmUploadHandler(data: ConfirmUploadDto, ctx: Ctx) {
    const { fileId, versionId, clientEntryId, source } = data;
    const { em } = ctx;

    const artifactFile = await em.findOneOrFail(ArtifactFileEntity, { id: fileId, artifact_version: versionId });

    if (artifactFile.status !== 'pending_upload') {
        throw new PublicError(400, {
            message: `File is in '${artifactFile.status}' state, expected 'pending_upload'`,
            code: 'INVALID_FILE_STATUS',
        });
    }

    if (!ctx.env.ARTIFACTS_BUCKET) {
        throw new PublicError(500, { message: 'File storage not configured', code: 'STORAGE_NOT_CONFIGURED' });
    }

    const r2Object = await ctx.env.ARTIFACTS_BUCKET.head(artifactFile.storage_key);
    if (!r2Object) {
        throw new PublicError(400, {
            message: 'File not found in storage. Upload may have failed or expired.',
            code: 'FILE_NOT_FOUND_IN_STORAGE',
        });
    }

    artifactFile.status = 'uploaded';
    await em.flush();

    const version = await em.findOneOrFail(ArtifactVersionEntity, versionId, {
        populate: ['artifact.project', 'artifact.chat'],
    });

    if (source === 'project-resources' && version.artifact.project?.id) {
        broadcastProjectResourceUploadUpdated(ctx, {
            projectId: version.artifact.project.id,
            entryId: clientEntryId ?? version.artifact.id,
            artifactId: version.artifact.id,
            fileId: artifactFile.id,
            name: artifactFile.original_name,
            size: artifactFile.size_bytes,
            status: 'processing',
        });
    }

    if (ctx.env.EXTRACTION_QUEUE) {
        try {
            const extractionQueue = new ExtractionQueueAdapter(ctx.env.EXTRACTION_QUEUE);
            await extractionQueue.send({
                type: 'extract_file_content',
                fileId: artifactFile.id,
                versionId,
                storageKey: artifactFile.storage_key,
                originalName: artifactFile.original_name,
                mimeType: artifactFile.mime_type,
                projectId: version.artifact.project?.id ?? null,
                chatId: version.artifact.chat?.id ?? null,
                previewAlias: ctx.previewAlias,
            });
        } catch (error) {
            console.error('[artifact-uploader] Failed to queue extraction:', error);
        }
    }

    return {
        success: true,
        artifactId: version.artifact.id,
        versionId: version.id,
        version: version.version,
        key: version.artifact.key,
    };
}

export async function associateArtifactsHandler(data: AssociateArtifactsDto, ctx: Ctx) {
    const { artifactIds, chatId, projectId } = data;
    const { em, user } = ctx;

    if (!chatId && !projectId) {
        throw new PublicError(400, { message: 'Either chatId or projectId is required', code: 'MISSING_SCOPE' });
    }

    // Validate ownership of the target scope + resolve internal user ID
    const { dbUserId } = await resolveScope(em, user, projectId, chatId);

    // Load staged artifacts owned by this user (identified via metadata.stagedBy)
    const artifacts = await em.find(
        ArtifactEntity,
        {
            id: { $in: artifactIds },
            project: null,
            chat: null,
            user: null,
            [raw("metadata->>'stagedBy'")]: dbUserId,
        },
        { populate: ['current_version', 'versions'] },
    );

    if (artifacts.length === 0) {
        return { success: true, associated: 0 };
    }

    // Associate each artifact with the target scope and clear staged metadata
    for (const artifact of artifacts) {
        if (projectId) artifact.project = em.getReference('ProjectEntity', projectId) as any;
        if (chatId) artifact.chat = em.getReference('ChatEntity', chatId) as any;
        artifact.user = em.getReference('UserEntity', dbUserId) as any;
        artifact.metadata = null;
    }

    await em.flush();

    // Queue embeddings for versions that have content (extraction already completed)
    for (const artifact of artifacts) {
        for (const version of artifact.versions.getItems()) {
            if (version.content && version.status === 'approved') {
                await queueEmbedding(ctx, version.id, version.content, artifact.key, projectId, chatId);
            }
        }
    }

    return { success: true, associated: artifacts.length };
}

async function queueEmbedding(
    ctx: Ctx,
    versionId: string,
    content: string,
    documentName: string,
    projectId?: string,
    chatId?: string,
) {
    if (!ctx.env.EMBEDDING_QUEUE) return;

    try {
        await ctx.env.EMBEDDING_QUEUE.send({
            type: 'index_artifact_version',
            projectId: projectId ?? null,
            chatId: chatId ?? null,
            versionId,
            content,
            documentName,
            is_ai_content: false,
            previewAlias: ctx.previewAlias,
        });
    } catch (error) {
        console.error('[artifact-uploader] Failed to queue embedding:', error);
    }
}
