import { ALLOWED_ARTIFACT_EXTENSIONS, MAX_ARTIFACT_UPLOAD_SIZE } from '@/lib/schema/artifact';

/**
 * Normalize artifact key - ensure .md extension.
 */
export function normalizeArtifactKey(key: string): string {
    const trimmed = key.trim();
    return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
}

/**
 * Validate a file for artifact upload (size + extension).
 * Returns `null` if valid, or an error message string.
 */
export function validateArtifactFile(file: File): string | null {
    if (file.size > MAX_ARTIFACT_UPLOAD_SIZE) {
        return `File too large (max ${MAX_ARTIFACT_UPLOAD_SIZE / 1024 / 1024}MB)`;
    }

    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_ARTIFACT_EXTENSIONS.includes(ext)) {
        return `Unsupported file type '${ext}'. Allowed: ${ALLOWED_ARTIFACT_EXTENSIONS.join(', ')}`;
    }

    return null;
}
