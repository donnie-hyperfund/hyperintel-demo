import { ALLOWED_ARTIFACT_EXTENSIONS, type ArtifactDto, MAX_ARTIFACT_UPLOAD_SIZE } from '@/lib/schema/artifact';

// ── Artifact DTO helpers ────────────────────────────────────────────────────

export function getLatestArtifactVersion(artifact: ArtifactDto) {
    return artifact.proposed_version ?? artifact.current_version;
}

export function getArtifactDocumentType(artifact: ArtifactDto) {
    return getLatestArtifactVersion(artifact)?.document_type;
}

export function isApprovedArtifact(artifact: ArtifactDto) {
    return getLatestArtifactVersion(artifact)?.status === 'approved';
}

// ── Upload error codes (shared between FE & BE) ────────────────────────────

export const UPLOAD_ERROR_CODES = {
    FILE_TOO_LARGE: 'FILE_TOO_LARGE',
    UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
    EMPTY_FILE: 'EMPTY_FILE',
} as const;

export type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[keyof typeof UPLOAD_ERROR_CODES];

const KNOWN_CODES = new Set<string>(Object.values(UPLOAD_ERROR_CODES));

/** Type-guard: is this error code one we control (i.e. message is user-safe)? */
export function isKnownUploadError(code: unknown): code is UploadErrorCode {
    return typeof code === 'string' && KNOWN_CODES.has(code);
}

// ── User-safe error class (FE only — marks a message as safe to display) ────

export class UploadValidationError extends Error {
    readonly code: UploadErrorCode;
    constructor(code: UploadErrorCode, message: string) {
        super(message);
        this.name = 'UploadValidationError';
        this.code = code;
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize artifact key - ensure .md extension.
 */
export function normalizeArtifactKey(key: string): string {
    const trimmed = key.trim();
    return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
}

export type ArtifactFileValidation = { code: UploadErrorCode; message: string };

/**
 * Validate a file for artifact upload (size + extension).
 * Returns `null` if valid, or `{ code, message }` with a human-readable message.
 */
export function validateArtifactFile(file: File): ArtifactFileValidation | null {
    if (file.size === 0) {
        return {
            code: UPLOAD_ERROR_CODES.EMPTY_FILE,
            message: 'The uploaded file has no content',
        };
    }

    if (file.size > MAX_ARTIFACT_UPLOAD_SIZE) {
        return {
            code: UPLOAD_ERROR_CODES.FILE_TOO_LARGE,
            message: `File too large (max ${MAX_ARTIFACT_UPLOAD_SIZE / 1024 / 1024}MB)`,
        };
    }

    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_ARTIFACT_EXTENSIONS.includes(ext)) {
        return {
            code: UPLOAD_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
            message: `Unsupported file type '${ext}'. Allowed: ${ALLOWED_ARTIFACT_EXTENSIONS.join(', ')}`,
        };
    }

    return null;
}
