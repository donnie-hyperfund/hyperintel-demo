/**
 * Document Service
 *
 * Database operations for document (artifact) entities.
 * Handles CRUD operations with proper name normalization.
 *
 * TODO: move what applicable to lib/ ?
 */

import type { EntityManager } from '@mikro-orm/core';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Normalize document name - ensure .md extension.
 */
export function normalizeDocumentName(name: string): string {
    const trimmed = name.trim();
    return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
}

/**
 * Count lines in content.
 */
export function countLines(content: string): number {
    if (!content) return 0;
    return content.split('\n').length;
}

/**
 * Format content with line numbers for viewport display.
 */
export function formatWithLineNumbers(content: string, startLine = 1): string {
    const lines = content.split('\n');
    return lines.map((line, i) => `${startLine + i}: ${line}`).join('\n');
}

/**
 * Extract viewport from content.
 */
export function extractViewport(
    content: string,
    startLine?: number,
    endLine?: number,
): { content: string; startLine: number; endLine: number; totalLines: number } {
    const lines = content.split('\n');
    const totalLines = lines.length;

    const start = Math.max(1, startLine ?? 1);
    const end = Math.min(totalLines, endLine ?? totalLines);

    const viewportLines = lines.slice(start - 1, end);
    const formattedContent = viewportLines.map((line, i) => `${start + i}: ${line}`).join('\n');

    return {
        content: formattedContent,
        startLine: start,
        endLine: end,
        totalLines,
    };
}

// ============================================================================
// EDIT OPERATIONS
// ============================================================================

export interface EditOperation {
    startLine: number;
    endLine: number;
    oldContent: string;
    newContent: string;
}

export interface EditResult {
    success: boolean;
    error?: string;
    newContent?: string;
    linesNow?: number;
}

/**
 * Apply precision edits to content.
 * Validates that oldContent matches exactly within the line range.
 */
export function applyEdits(content: string, edits: EditOperation[]): EditResult {
    let currentContent = content;

    // Validate all edits first (atomic)
    for (const edit of edits) {
        const lines = currentContent.split('\n');
        const totalLines = lines.length;

        // Validate line range
        if (edit.startLine < 1 || edit.endLine > totalLines || edit.startLine > edit.endLine) {
            return {
                success: false,
                error: `Invalid line range ${edit.startLine}-${edit.endLine}. Document has ${totalLines} lines.`,
            };
        }

        // Extract the range
        const rangeLines = lines.slice(edit.startLine - 1, edit.endLine);
        const rangeContent = rangeLines.join('\n');

        // Check for exact match
        const matchIndex = rangeContent.indexOf(edit.oldContent);
        if (matchIndex === -1) {
            return {
                success: false,
                error: `oldContent not found in lines ${edit.startLine}-${edit.endLine}. Content may have changed.`,
            };
        }

        // Check for multiple matches (ambiguous)
        const secondMatch = rangeContent.indexOf(edit.oldContent, matchIndex + 1);
        if (secondMatch !== -1) {
            return {
                success: false,
                error: `Multiple matches for oldContent in lines ${edit.startLine}-${edit.endLine}. Edit is ambiguous.`,
            };
        }
    }

    // Apply all edits (now that validation passed)
    for (const edit of edits) {
        const lines = currentContent.split('\n');
        const rangeLines = lines.slice(edit.startLine - 1, edit.endLine);
        const rangeContent = rangeLines.join('\n');

        // Apply replacement
        const newRangeContent = rangeContent.replace(edit.oldContent, edit.newContent);

        // Rebuild content
        const before = lines.slice(0, edit.startLine - 1);
        const after = lines.slice(edit.endLine);
        currentContent = [...before, ...newRangeContent.split('\n'), ...after].join('\n');
    }

    return {
        success: true,
        newContent: currentContent,
        linesNow: countLines(currentContent),
    };
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

export interface DocumentInfo {
    id: string;
    name: string;
    title: string;
    version: number;
    content: string;
    lineCount: number;
}

/**
 * Find document by name in project.
 */
export async function findDocumentByName(
    em: EntityManager,
    projectId: string,
    name: string,
): Promise<DocumentInfo | null> {
    const normalizedName = normalizeDocumentName(name);

    const artifact = await em.findOne(
        ArtifactEntity,
        { project: projectId, key: normalizedName },
        { populate: ['current_version'] },
    );

    if (!artifact) return null;

    return {
        id: artifact.id,
        name: artifact.key,
        title: artifact.title,
        version: artifact.version,
        content: artifact.current_version?.content ?? '',
        lineCount: countLines(artifact.current_version?.content ?? ''),
        // TODO: Use lineCount from entity once added
    };
}

/**
 * List all documents in project.
 */
export async function listDocuments(
    em: EntityManager,
    projectId: string,
    filter?: { search?: string },
): Promise<Array<{ name: string; title: string; lines: number; version: number }>> {
    const where: Record<string, unknown> = { project: projectId };

    // TODO: Add search filter on name/title when needed

    const artifacts = await em.find(ArtifactEntity, where, { populate: ['current_version'] });

    return artifacts.map((a) => ({
        name: a.key,
        title: a.title,
        lines: countLines(a.current_version?.content ?? ''),
        version: a.version,
    }));
}

/**
 * Create or update a document with new content.
 * Returns info about the action taken.
 */
export async function upsertDocument(
    em: EntityManager,
    projectId: string,
    chatId: string,
    name: string,
    title: string,
    content: string,
): Promise<{
    action: 'created' | 'replaced';
    name: string;
    version: number;
    versionId: string;
    lines: number;
    previousVersion?: number;
    previousVersionLines?: number;
}> {
    const normalizedName = normalizeDocumentName(name);
    const lineCount = countLines(content);

    // Check if exists
    const existing = await em.findOne(
        ArtifactEntity,
        { project: projectId, key: normalizedName },
        { populate: ['current_version'] },
    );

    if (existing) {
        // Replace existing
        const previousVersion = existing.version;
        const previousLineCount = countLines(existing.current_version?.content ?? '');

        // Create new version
        const newVersion = new ArtifactVersionEntity();
        newVersion.artifact = existing;
        newVersion.version = previousVersion + 1;
        newVersion.content = content;

        em.persist(newVersion);

        // Update artifact
        existing.version = previousVersion + 1;
        existing.title = title;
        existing.current_version = newVersion;

        await em.flush();

        return {
            action: 'replaced',
            name: normalizedName,
            version: previousVersion + 1,
            versionId: newVersion.id,
            lines: lineCount,
            previousVersion,
            previousVersionLines: previousLineCount,
        };
    } else {
        // Create new - two-phase insert wrapped in transaction to handle circular FK
        // Transaction ensures atomicity: if phase 2 fails, phase 1 is rolled back
        let createdVersionId = '';

        await em.transactional(async (txEm) => {
            // Phase 1: Create artifact (current_version will be NULL initially)
            const artifact = new ArtifactEntity();
            artifact.key = normalizedName;
            artifact.title = title;
            artifact.version = 1;
            artifact.project = txEm.getReference('ProjectEntity', projectId) as any;
            artifact.chat = txEm.getReference('ChatEntity', chatId) as any;

            txEm.persist(artifact);
            await txEm.flush();

            // Phase 2: Create version and link it
            const version = new ArtifactVersionEntity();
            version.artifact = artifact;
            version.version = 1;
            version.content = content;

            txEm.persist(version);
            artifact.current_version = version;

            await txEm.flush();
            createdVersionId = version.id;
        });

        return {
            action: 'created',
            name: normalizedName,
            version: 1,
            versionId: createdVersionId,
            lines: lineCount,
        };
    }
}

/**
 * Update document content directly (for edit_document on committed version).
 */
export async function updateDocumentContent(
    em: EntityManager,
    projectId: string,
    name: string,
    newContent: string,
): Promise<{
    version: number;
    linesNow: number;
} | null> {
    const normalizedName = normalizeDocumentName(name);

    const existing = await em.findOne(
        ArtifactEntity,
        { project: projectId, key: normalizedName },
        { populate: ['current_version'] },
    );

    if (!existing) return null;

    const previousVersion = existing.version;
    const lineCount = countLines(newContent);

    // Create new version
    const newVersion = em.create(ArtifactVersionEntity, {
        artifact: existing,
        version: previousVersion + 1,
        content: newContent,
        // TODO: lineCount field
    });
    em.persist(newVersion);

    // Update artifact
    existing.version = previousVersion + 1;
    existing.current_version = newVersion;

    await em.flush();

    return {
        version: previousVersion + 1,
        linesNow: lineCount,
    };
}
