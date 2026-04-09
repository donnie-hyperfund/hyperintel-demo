/**
 * Image upload handler for chat message attachments.
 * Separate from artifact-uploader — images skip the document pipeline entirely.
 * Flow: presign → upload to R2 → confirm → attach to message at send time.
 */

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PublicError } from '@common/common/error.helpers';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { createWorkerS3Client } from '@/lib/vendor/r2';
import type { Ctx } from './context';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB
const PRESIGN_EXPIRY_SECONDS = 60 * 10;
const READ_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour for signed GET URLs

// ============================================================================
// HELPERS
// ============================================================================

function getExtension(filename: string): string {
    return filename.slice(filename.lastIndexOf('.')).toLowerCase();
}

function getBucketName(env: Env): string {
    return env.ENV === 'dev' ? 'hi-user-images-dev' : 'hi-user-images';
}

function buildStorageKey(chatId: string, filename: string): string {
    const ext = getExtension(filename);
    return `chat-images/${chatId}/${crypto.randomUUID()}${ext}`;
}

// ============================================================================
// SCHEMAS (inline — lightweight, no need for separate file)
// ============================================================================

import { z } from 'zod';
import { IMAGE_EXTENSIONS, IMAGE_MIME_TYPES, isImageExtension } from '@/lib/schema/artifact';

export const PresignImageUploadSchema = z.object({
    filename: z.string().min(1),
    fileSize: z.number().int().positive().max(MAX_IMAGE_SIZE),
    chatId: z.string().uuid(),
});
export type PresignImageUploadDto = z.infer<typeof PresignImageUploadSchema>;

export const ConfirmImageUploadSchema = z.object({
    fileId: z.string().uuid(),
});
export type ConfirmImageUploadDto = z.infer<typeof ConfirmImageUploadSchema>;

// ============================================================================
// HANDLERS
// ============================================================================

export async function presignImageUploadHandler(data: PresignImageUploadDto, ctx: Ctx) {
    const { filename, fileSize, chatId } = data;
    const { em, user } = ctx;

    const ext = getExtension(filename);
    if (!isImageExtension(ext)) {
        throw new PublicError(400, {
            message: `Unsupported image type '${ext}'. Allowed: ${IMAGE_EXTENSIONS.join(', ')}`,
            code: 'UNSUPPORTED_IMAGE_TYPE',
        });
    }

    if (fileSize > MAX_IMAGE_SIZE) {
        throw new PublicError(400, {
            message: `Image too large (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`,
            code: 'IMAGE_TOO_LARGE',
        });
    }

    // Verify chat ownership (phase chats go through project.user, intake chats have direct user FK)
    await em.findOneOrFail(ChatEntity, {
        id: chatId,
        $or: [{ project: { user: { clerkId: user.userId } } }, { user: { clerkId: user.userId } }],
    });

    const mimeType = IMAGE_MIME_TYPES[ext] ?? 'application/octet-stream';
    const storageKey = buildStorageKey(chatId, filename);

    // Create file record
    const file = new ChatMessageFileEntity();
    file.chat_id = chatId;
    file.storage_key = storageKey;
    file.original_name = filename;
    file.mime_type = mimeType;
    file.size_bytes = fileSize;
    file.status = 'pending_upload';

    em.persist(file);
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

    return {
        uploadUrl,
        fileId: file.id,
        storageKey,
    };
}

export async function confirmImageUploadHandler(data: ConfirmImageUploadDto, ctx: Ctx) {
    const { fileId } = data;
    const { em, user } = ctx;

    const file = await em.findOneOrFail(ChatMessageFileEntity, { id: fileId });

    // Verify chat ownership
    await em.findOneOrFail(ChatEntity, {
        id: file.chat_id,
        $or: [{ project: { user: { clerkId: user.userId } } }, { user: { clerkId: user.userId } }],
    });

    if (file.status !== 'pending_upload') {
        throw new PublicError(400, {
            message: `File is in '${file.status}' state, expected 'pending_upload'`,
            code: 'INVALID_FILE_STATUS',
        });
    }

    // Verify file exists in storage via S3 API (works both in CF workers and locally)
    const s3 = await createWorkerS3Client(ctx.env);
    try {
        await s3.send(new HeadObjectCommand({ Bucket: getBucketName(ctx.env), Key: file.storage_key }));
    } catch {
        throw new PublicError(400, {
            message: 'File not found in storage. Upload may have failed or expired.',
            code: 'FILE_NOT_FOUND_IN_STORAGE',
        });
    }

    file.status = 'uploaded';
    await em.flush();

    return {
        success: true,
        fileId: file.id,
    };
}

// ============================================================================
// SIGNED URL GENERATION (used at context build time)
// ============================================================================

/**
 * Generate signed GET URLs for image files.
 * Called when building LLM context to create temporary readable URLs.
 */
export async function generateSignedImageUrls(env: Env, files: ChatMessageFileEntity[]): Promise<Map<string, string>> {
    if (files.length === 0) return new Map();

    const s3 = await createWorkerS3Client(env);
    const bucket = getBucketName(env);
    const urlMap = new Map<string, string>();

    await Promise.all(
        files.map(async (file) => {
            const command = new GetObjectCommand({
                Bucket: bucket,
                Key: file.storage_key,
            });
            const url = await getSignedUrl(s3, command, { expiresIn: READ_URL_EXPIRY_SECONDS });
            urlMap.set(file.id, url);
        }),
    );

    return urlMap;
}
