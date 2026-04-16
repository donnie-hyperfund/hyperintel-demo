/**
 * Image upload handler for chat message attachments.
 * Separate from artifact-uploader — images skip the document pipeline entirely.
 * Flow: presign → upload to R2 → confirm → attach to message at send time.
 */

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PublicError } from '@common/common/error.helpers';
import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { createWorkerS3Client } from '@/lib/vendor/r2';
import type { Ctx } from '../context';
import { resolveDbUserId, verifyChatOwnership } from './scope';

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

function buildStorageKey(filename: string, scope: { chatId?: string; userId?: string }): string {
    const ext = getExtension(filename);
    const prefix = scope.chatId ? scope.chatId : `staged/${scope.userId}`;
    return `chat-images/${prefix}/${crypto.randomUUID()}${ext}`;
}

/** Key prefix used for images uploaded before a chat exists (mirrors artifact staging). */
function stagedPrefixForUser(dbUserId: string): string {
    return `chat-images/staged/${dbUserId}/`;
}

/** True when the file was uploaded via the staged flow (no chat yet). */
export function isStagedImageKey(storageKey: string): boolean {
    return storageKey.startsWith('chat-images/staged/');
}

// ============================================================================
// SCHEMAS (inline — lightweight, no need for separate file)
// ============================================================================

import { z } from 'zod';
import { IMAGE_EXTENSIONS, IMAGE_MIME_TYPES, isImageExtension } from '@/lib/schema/artifact';

export const PresignImageUploadSchema = z.object({
    filename: z.string().min(1),
    fileSize: z.number().int().positive().max(MAX_IMAGE_SIZE),
    /** Optional — when omitted, the image is staged under the current user and must be
     *  associated with a chat later via /uploads/associate. Mirrors the staged-artifact flow. */
    chatId: z.string().uuid().optional(),
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

    // For scoped uploads, chat ownership gates the presign. For staged uploads, we just
    // need the internal userId — it's encoded in the storage key so associate-time checks
    // can verify the caller owns the file.
    const dbUserId = chatId ? await verifyChatOwnership(em, user, chatId) : await resolveDbUserId(em, user);

    const mimeType = IMAGE_MIME_TYPES[ext] ?? 'application/octet-stream';
    const storageKey = buildStorageKey(filename, { chatId, userId: dbUserId });

    // Create file record
    const file = new ChatMessageFileEntity();
    file.chat_id = chatId ?? null;
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

    if (file.chat_id) {
        // Associated upload — verify chat ownership
        await verifyChatOwnership(em, user, file.chat_id);
    } else {
        // Staged upload — verify ownership by matching the userId embedded in storage_key
        const dbUserId = await resolveDbUserId(em, user);
        if (!file.storage_key.startsWith(stagedPrefixForUser(dbUserId))) {
            throw new PublicError(403, { message: 'Not your file', code: 'FORBIDDEN' });
        }
    }

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

/**
 * Associate staged chat-message images (uploaded without a chatId) with a chat.
 * Caller is responsible for having already verified that `dbUserId` owns `chatId`.
 * Ownership of individual files is re-verified here via the storage_key prefix.
 * Returns the number of images that were successfully associated.
 */
export async function associateImagesInternal(
    em: Ctx['em'],
    dbUserId: string,
    chatId: string,
    imageFileIds: string[],
): Promise<number> {
    if (imageFileIds.length === 0) return 0;

    const imageFiles = await em.find(ChatMessageFileEntity, {
        id: { $in: imageFileIds },
        chat_id: null,
        storage_key: { $like: `${stagedPrefixForUser(dbUserId)}%` },
    });

    if (imageFiles.length === 0) return 0;

    for (const file of imageFiles) {
        file.chat_id = chatId;
    }
    await em.flush();
    return imageFiles.length;
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
