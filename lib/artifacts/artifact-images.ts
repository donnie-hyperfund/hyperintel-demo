/**
 * R2 utilities for artifact-embedded images.
 *
 * - `uploadArtifactImage` — upload image bytes to the artifacts bucket (extraction worker)
 * - `signArtifactImageKeys` — batch-sign R2 keys for reading (chat worker)
 */

import type { ContentPart } from '@/common/ai/inference/types';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { buildArtifactImageContentParts, extractArtifactImageRefs } from '@/lib/markdown/artifact-images';
import { createWorkerS3Client } from '@/lib/vendor/r2';

// ============================================================================
// CONSTANTS
// ============================================================================

const SIGN_EXPIRY_SECONDS = 60 * 60; // 1 hour

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
};

// ============================================================================
// UPLOAD
// ============================================================================

/**
 * Upload image bytes to the artifacts R2 bucket.
 *
 * @param r2Bucket - The `ARTIFACTS_BUCKET` R2 binding
 * @param storagePrefix - e.g. `uploads/{scope}/{versionId}/images`
 * @param bytes - Raw image bytes
 * @param contentType - MIME type (image/png, image/jpeg, etc.)
 * @returns Full R2 storage key
 */
export async function uploadArtifactImage(
    r2Bucket: R2Bucket,
    storagePrefix: string,
    bytes: ArrayBuffer,
    contentType: string,
): Promise<string> {
    const ext = CONTENT_TYPE_TO_EXT[contentType] ?? '.png';
    const key = `${storagePrefix}/${crypto.randomUUID()}${ext}`;

    await r2Bucket.put(key, bytes, {
        httpMetadata: { contentType },
    });

    return key;
}

// ============================================================================
// SIGNING
// ============================================================================

function getArtifactsBucketName(env: { ENV: string }): string {
    return env.ENV === 'dev' ? 'hi-artifacts-dev' : 'hi-artifacts';
}

/**
 * Batch-sign R2 storage keys against the artifacts bucket.
 * Returns a map of `storageKey → signedUrl`.
 */
export async function signArtifactImageKeys(
    env: {
        ENV: string;
        CF_ACCOUNT_ID: { get(): Promise<string> };
        R2_ACCESS_KEY_ID: { get(): Promise<string> };
        R2_SECRET_ACCESS_KEY: { get(): Promise<string> };
    },
    keys: string[],
): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();

    const s3 = await createWorkerS3Client(env);
    const bucket = getArtifactsBucketName(env);
    const urlMap = new Map<string, string>();

    await Promise.all(
        keys.map(async (key) => {
            const command = new GetObjectCommand({ Bucket: bucket, Key: key });
            const url = await getSignedUrl(s3, command, { expiresIn: SIGN_EXPIRY_SECONDS });
            urlMap.set(key, url);
        }),
    );

    return urlMap;
}

// ============================================================================
// HYDRATION
// ============================================================================

type SigningEnv = Parameters<typeof signArtifactImageKeys>[0];

export interface HydrationScope {
	projectId?: string;
	chatId?: string;
}

export interface HydratedArtifactImages {
	/** Original text with artifact-image:// refs intact */
	text: string;
	/** Full ref strings (artifact-image://...) for toolImageRefs */
	imageRefs: string[];
	/** Multimodal content parts (interleaved text + signed images) */
	contentParts: ContentPart[];
}

/**
 * Check if an R2 key belongs to the given scope.
 * Keys look like `uploads/project/{id}/{artifactId}/images/{filename}`
 * or `uploads/chat/{id}/{artifactId}/images/{filename}`.
 * Returns false for keys that don't match — they won't be signed.
 */
function keyMatchesScope(key: string, scope: HydrationScope): boolean {
	const parts = key.split('/');
	// Expected: uploads/{scopeType}/{scopeId}/{artifactId}/images/{filename}
	if (parts.length < 6 || parts[0] !== 'uploads' || parts[4] !== 'images' || !parts[5]) return false;

	const scopeType = parts[1];
	const scopeId = parts[2];

	if (scopeType === 'project' && scope.projectId) return scopeId === scope.projectId;
	if (scopeType === 'chat' && scope.chatId) return scopeId === scope.chatId;

	return false;
}

/**
 * One-call image hydration: extract refs → scope-filter → sign → build content parts.
 * Returns `null` when no signable `artifact-image://` refs are found (no signing overhead).
 */
export async function hydrateArtifactImages(
	text: string,
	env: SigningEnv,
	scope: HydrationScope,
): Promise<HydratedArtifactImages | null> {
	const refs = extractArtifactImageRefs(text);
	if (refs.length === 0) return null;

	// Only sign keys that belong to the current scope
	const allowedKeys = refs.map((r) => r.key).filter((k) => keyMatchesScope(k, scope));
	if (allowedKeys.length === 0) return null;

	const SCHEME = 'artifact-image://';
	const signedUrls = await signArtifactImageKeys(env, allowedKeys);

	return {
		text,
		imageRefs: allowedKeys.map((k) => `${SCHEME}${k}`),
		contentParts: buildArtifactImageContentParts(text, signedUrls),
	};
}
