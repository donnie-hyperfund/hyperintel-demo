/**
 * Normalize artifact key - ensure .md extension.
 */
export function normalizeArtifactKey(key: string): string {
    const trimmed = key.trim();
    return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
}
