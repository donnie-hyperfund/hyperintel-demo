/**
 * Document Service
 *
 * Database operations for document (artifact) entities.
 * Handles CRUD operations with proper name normalization.
 *
 * TODO: move what applicable to lib/ ?
 *
 * Versioning:
 * - All version CONTENT is immutable once created
 * - Versions have status: proposed | approved | rejected | superseded
 * - Only ONE proposed version can exist per artifact at a time
 * - When agent creates new version while proposed exists → old becomes superseded
 * - current_version always points to latest approved (null if none approved yet)
 */

import type { EntityManager } from '@mikro-orm/core';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity, type VersionStatus } from '@/lib/orm/entities/artifacts/artifact-version.entity';

// ============================================================================
// UTILITIES
// ============================================================================

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
// VERSION STATUS HELPERS
// ============================================================================

/**
 * Find the latest version with a specific status.
 */
export async function findVersionByStatus(
    em: EntityManager,
    artifactId: string,
    status: VersionStatus,
): Promise<ArtifactVersionEntity | null> {
    return em.findOne(ArtifactVersionEntity, { artifact: artifactId, status }, { orderBy: { version: 'DESC' } });
}

/**
 * Find the best version to base edits on.
 * Priority: proposed > rejected > approved
 */
export async function findBaseVersionForEdit(
    em: EntityManager,
    artifactId: string,
): Promise<
    | { version: ArtifactVersionEntity; mode: 'supersede-proposed' | 'revise-rejected' | 'edit-approved' }
    | { error: string }
> {
    // Check for proposed - will supersede it
    const proposed = await findVersionByStatus(em, artifactId, 'proposed');
    if (proposed) {
        return { version: proposed, mode: 'supersede-proposed' };
    }

    // Check for rejected - revise it
    const rejected = await findVersionByStatus(em, artifactId, 'rejected');
    if (rejected) {
        return { version: rejected, mode: 'revise-rejected' };
    }

    // Default: base on approved
    const approved = await findVersionByStatus(em, artifactId, 'approved');
    if (approved) {
        return { version: approved, mode: 'edit-approved' };
    }

    return { error: 'No version found to edit' };
}

/**
 * Mark a proposed version as superseded.
 */
export async function supersedeProposedVersion(
    em: EntityManager,
    artifactId: string,
    newVersionNumber: number,
): Promise<void> {
    const proposed = await findVersionByStatus(em, artifactId, 'proposed');
    if (proposed) {
        proposed.status = 'superseded';
        proposed.rejection_reason = `Superseded by v${newVersionNumber}`;
        proposed.status_changed_at = new Date();
        await em.flush();
    }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

export interface DocumentInfo {
    id: string;
    name: string;
    title: string;
    currentVersion: number | null;
    currentContent: string | null;
    currentStatus: VersionStatus | null;
    currentDocumentType: string | null;
    proposedVersion: number | null;
    proposedContent: string | null;
    proposedDocumentType: string | null;
    rejectedVersion: number | null;
    rejectedContent: string | null;
    rejectedDocumentType: string | null;
    rejectionReason: string | null;
    lineCount: number;
}

/**
 * Find document by name in project with version status info.
 */
export async function findDocumentByName(
    em: EntityManager,
    projectId: string,
    name: string,
): Promise<DocumentInfo | null> {
    const normalizedName = normalizeArtifactKey(name);

    const artifact = await em.findOne(
        ArtifactEntity,
        { project: projectId, key: normalizedName },
        { populate: ['current_version', 'versions'] },
    );

    if (!artifact) return null;

    const versions = artifact.versions.getItems();
    const proposed = versions.find((v) => v.status === 'proposed');
    const rejected = versions.filter((v) => v.status === 'rejected').sort((a, b) => b.version - a.version)[0];

    const currentContent = artifact.current_version?.content ?? null;
    const proposedContent = proposed?.content ?? null;
    const rejectedContent = rejected?.content ?? null;

    return {
        id: artifact.id,
        name: artifact.key,
        title: artifact.title,
        currentVersion: artifact.current_version?.version ?? null,
        currentContent,
        currentStatus: artifact.current_version?.status ?? null,
        currentDocumentType: artifact.current_version?.document_type ?? null,
        proposedVersion: proposed?.version ?? null,
        proposedContent,
        proposedDocumentType: proposed?.document_type ?? null,
        rejectedVersion: rejected?.version ?? null,
        rejectedContent,
        rejectedDocumentType: rejected?.document_type ?? null,
        rejectionReason: rejected?.rejection_reason ?? null,
        lineCount: countLines(proposedContent ?? currentContent ?? ''),
        // TODO: Use lineCount from entity once added
    };
}

export interface DocumentListItem {
    name: string;
    title: string;
    lines: number;
    currentVersion: number | null;
    currentStatus: VersionStatus | null;
    latestVersion: number;
    latestStatus: VersionStatus;
    hasProposed: boolean;
}

/**
 * List all documents in project with version status info.
 */
export async function listDocuments(
    em: EntityManager,
    projectId: string,
    filter?: { search?: string },
): Promise<DocumentListItem[]> {
    // TODO: Add search filter on name/title when needed

    const artifacts = await em.find(
        ArtifactEntity,
        // TODO allow including deleted artifacts
        { project: projectId, $or: [{ current_version: null }, { current_version: { status: { $ne: 'deleted' } } }] },
        { populate: ['current_version', 'versions'] },
    );

    return artifacts.map((a) => {
        const versions = a.versions.getItems();
        const latest = versions.sort((x, y) => y.version - x.version)[0];
        const proposed = versions.find((v) => v.status === 'proposed');

        const contentForLines = proposed?.content ?? a.current_version?.content ?? '';

        return {
            name: a.key,
            title: a.title,
            lines: countLines(contentForLines),
            currentVersion: a.current_version?.version ?? null,
            currentStatus: a.current_version?.status ?? null,
            latestVersion: latest?.version ?? 0,
            latestStatus: latest?.status ?? 'approved',
            hasProposed: !!proposed,
        };
    });
}

/**
 * Create or update a document with new content.
 * Creates version with status 'proposed' - does NOT update current_version.
 * If proposed version exists, it becomes superseded.
 */
export async function upsertDocument(
    em: EntityManager,
    projectId: string,
    chatId: string,
    name: string,
    title: string,
    content: string,
    is_internal = true,
    document_type = 'Other',
): Promise<{
    action: 'created' | 'proposed';
    name: string;
    version: number;
    versionId: string;
    lines: number;
    supersededVersion?: number;
}> {
    const normalizedName = normalizeArtifactKey(name);
    const lineCount = countLines(content);

    // Check if artifact exists
    const existing = await em.findOne(
        ArtifactEntity,
        { project: projectId, key: normalizedName },
        { populate: ['current_version', 'versions'] },
    );

    if (existing) {
        // Find current max version number
        const versions = existing.versions.getItems();
        const maxVersion = Math.max(...versions.map((v) => v.version), 0);
        const newVersionNum = maxVersion + 1;

        // Supersede any existing proposed version
        const existingProposed = versions.find((v) => v.status === 'proposed');
        const supersededVersion = existingProposed?.version;

        if (existingProposed) {
            existingProposed.status = 'superseded';
            existingProposed.rejection_reason = `Superseded by v${newVersionNum}`;
            existingProposed.status_changed_at = new Date();
        }

        // Create new proposed version
        const newVersion = new ArtifactVersionEntity();
        newVersion.artifact = existing;
        newVersion.version = newVersionNum;
        newVersion.content = content;
        newVersion.status = 'proposed';
        newVersion.is_internal = is_internal;
        newVersion.document_type = document_type as any;
        newVersion.status_changed_at = new Date();
        newVersion.chat = em.getReference('ChatEntity', chatId) as any;

        em.persist(newVersion);

        // Update artifact's version counter (but NOT current_version - that only changes on approval)
        existing.version = newVersionNum;
        existing.title = title;

        await em.flush();

        return {
            action: 'proposed',
            name: normalizedName,
            version: newVersionNum,
            versionId: newVersion.id,
            lines: lineCount,
            supersededVersion,
        };
    } else {
        // Create new - two-phase insert wrapped in transaction to handle circular FK
        // Transaction ensures atomicity: if phase 2 fails, phase 1 is rolled back
        let createdVersionId = '';

        await em.transactional(async (txEm) => {
            // Phase 1: Create artifact (current_version will be NULL - nothing approved yet)
            const artifact = new ArtifactEntity();
            artifact.key = normalizedName;
            artifact.title = title;
            artifact.version = 1;
            artifact.project = txEm.getReference('ProjectEntity', projectId) as any;
            // current_version stays null until first approval

            txEm.persist(artifact);
            await txEm.flush();

            // Phase 2: Create proposed version
            const version = new ArtifactVersionEntity();
            version.artifact = artifact;
            version.version = 1;
            version.content = content;
            version.status = 'proposed';
            version.is_internal = is_internal;
            version.document_type = document_type as any;
            version.status_changed_at = new Date();
            version.chat = txEm.getReference('ChatEntity', chatId) as any;

            txEm.persist(version);
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
 * Approve a proposed version - makes it the current_version.
 */
export async function approveVersion(
    em: EntityManager,
    versionId: string,
    approvedBy?: string,
): Promise<{ success: true; version: number } | { success: false; error: string }> {
    const version = await em.findOne(ArtifactVersionEntity, { id: versionId }, { populate: ['artifact'] });

    if (!version) {
        return { success: false, error: 'Version not found' };
    }

    if (version.status !== 'proposed') {
        return { success: false, error: `Cannot approve version with status '${version.status}'` };
    }

    // Update version status
    version.status = 'approved';
    version.status_changed_at = new Date();
    version.status_changed_by = approvedBy;

    // Update artifact's current_version
    version.artifact.current_version = version;

    await em.flush();

    return { success: true, version: version.version };
}

/**
 * Reject a proposed version.
 */
export async function rejectVersion(
    em: EntityManager,
    versionId: string,
    reason: string,
    rejectedBy?: string,
): Promise<{ success: true; version: number } | { success: false; error: string }> {
    const version = await em.findOne(ArtifactVersionEntity, { id: versionId });

    if (!version) {
        return { success: false, error: 'Version not found' };
    }

    if (version.status !== 'proposed') {
        return { success: false, error: `Cannot reject version with status '${version.status}'` };
    }

    version.status = 'rejected';
    version.rejection_reason = reason;
    version.status_changed_at = new Date();
    version.status_changed_by = rejectedBy;

    await em.flush();

    return { success: true, version: version.version };
}
