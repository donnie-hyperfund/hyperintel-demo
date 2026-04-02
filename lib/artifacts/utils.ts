import {
    ALLOWED_ARTIFACT_EXTENSIONS,
    type ArtifactDto,
    isBinaryArtifactExtension,
    isTextArtifactExtension,
    MAX_ARTIFACT_UPLOAD_SIZE,
} from '@/lib/schema/artifact';
import type { CamelCaseDto } from '@/lib/api/client/types';

// ── Artifact DTO helpers ────────────────────────────────────────────────────

export function getLatestArtifactVersion(artifact: CamelCaseDto<ArtifactDto>) {
    return artifact.proposedVersion ?? artifact.currentVersion;
}

export function getArtifactDocumentType(artifact: CamelCaseDto<ArtifactDto>) {
    return getLatestArtifactVersion(artifact)?.documentType;
}

export function isApprovedArtifact(artifact: CamelCaseDto<ArtifactDto>) {
    return getLatestArtifactVersion(artifact)?.status === 'approved';
}

/** Extract the source project name from a published artifact's metadata (Legacy DNA). */
export function getSourceProjectName(artifact: CamelCaseDto<ArtifactDto>): string | undefined {
    const publishedFrom = artifact.metadata?.publishedFrom as { projectName?: string } | undefined;
    return publishedFrom?.projectName;
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

export function normalizeArtifactKey(key: string): string {
    const trimmed = key.trim();
    const ext = trimmed.slice(trimmed.lastIndexOf('.')).toLowerCase();
    if (isBinaryArtifactExtension(ext)) return trimmed;
    return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
}

export function normalizeUploadedFileKey(filename: string): string {
    let trimmed = filename.trim();
    const ext = trimmed.slice(trimmed.lastIndexOf('.')).toLowerCase();
    if (isBinaryArtifactExtension(ext)) return trimmed;
    // Strip any text extension (.txt, .rtf, etc.) so everything normalizes to .md
    if (isTextArtifactExtension(ext) && ext !== '.md') trimmed = trimmed.slice(0, trimmed.lastIndexOf('.'));
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
