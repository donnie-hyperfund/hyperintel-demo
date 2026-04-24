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
// SCOPE — project-scoped or user-scoped artifacts
// ============================================================================

export type DocumentScope = { projectId: string } | { userId: string; chatId?: string };

/** Build a MikroORM where-clause fragment from a scope. */
function scopeFilter(scope: DocumentScope): Record<string, unknown> {
    if ('projectId' in scope) return { project: scope.projectId };
    if (scope.chatId) return { $or: [{ user: scope.userId, project: null }, { chat: scope.chatId }] };
    return { user: scope.userId, project: null };
}

/** Set the owner (project or user) on a new artifact entity. */
function setArtifactOwner(artifact: ArtifactEntity, scope: DocumentScope, em: EntityManager) {
    if ('projectId' in scope) {
        artifact.project = em.getReference('ProjectEntity', scope.projectId) as any;
    } else {
        artifact.user = em.getReference('UserEntity', scope.userId) as any;
    }
}

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
    /** Optional: inferred from oldContent line count when omitted. */
    endLine?: number | null;
    oldContent: string;
    newContent: string;
}

/** Resolved edit — coords reflect state after prior edits in the batch; content is full-range. */
export interface AppliedEdit {
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
    appliedEdits?: AppliedEdit[];
}

const LINE_WIGGLE = 2;

const NORMALIZE_PATCH_NEWLINES = true;
const TOLERATE_PATCH_TRAILING_NEWLINE_MISMATCH = true;
const STRIP_NUMBERED_LINE_PREFIXES_FROM_PATCH_OLD_CONTENT = true;

interface PreparedEdit {
    startLine: number;
    endLine: number;
    oldContent: string;
    newContent: string;
    oldContentCandidates: string[];
}

function normalizePatchNewlines(content: string): string {
    return NORMALIZE_PATCH_NEWLINES ? content.replace(/\r\n?/g, '\n') : content;
}

function stripNumberedLinePrefixes(content: string, startLine: number): string {
    if (!STRIP_NUMBERED_LINE_PREFIXES_FROM_PATCH_OLD_CONTENT) return content;

    const lines = content.split('\n');
    if (!lines.length) return content;

    const numberedLines = lines
        .map((line) => line.match(/^(\d+):\s?/))
        .filter((match): match is RegExpMatchArray => Boolean(match));
    if (!numberedLines.length) return content;

    // Only strip when every non-empty copied line looks like sequential read_document output.
    const allContentLinesAreNumbered = lines.every((line) => line === '' || /^\d+:\s?/.test(line));
    const lineNumbers = numberedLines.map((match) => Number(match[1]));
    const isSequentialViewport = lineNumbers.every((lineNumber, index) =>
        index === 0 ? Math.abs(lineNumber - startLine) <= LINE_WIGGLE : lineNumber === lineNumbers[index - 1] + 1,
    );

    if (!allContentLinesAreNumbered || !isSequentialViewport) return content;
    return lines.map((line) => line.replace(/^\d+:\s?/, '')).join('\n');
}

function trimOneTrailingNewline(content: string): string {
    return content.endsWith('\n') ? content.slice(0, -1) : content;
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values)];
}

function oldContentCandidates(oldContent: string): string[] {
    const candidates = [oldContent];

    if (TOLERATE_PATCH_TRAILING_NEWLINE_MISMATCH) {
        if (oldContent.endsWith('\n')) {
            candidates.push(trimOneTrailingNewline(oldContent));
        } else {
            candidates.push(`${oldContent}\n`);
        }
    }

    return uniqueStrings(candidates);
}

export function inferEndLine(startLine: number, oldContent: string): number {
    const contentForInference = TOLERATE_PATCH_TRAILING_NEWLINE_MISMATCH
        ? trimOneTrailingNewline(oldContent)
        : oldContent;
    return startLine + Math.max(1, countLines(contentForInference)) - 1;
}

function prepareEdit(edit: EditOperation): PreparedEdit {
    const oldContent = stripNumberedLinePrefixes(normalizePatchNewlines(edit.oldContent), edit.startLine);
    const newContent = normalizePatchNewlines(edit.newContent);
    const endLine = edit.endLine ?? inferEndLine(edit.startLine, oldContent);

    return {
        startLine: edit.startLine,
        endLine,
        oldContent,
        newContent,
        oldContentCandidates: oldContentCandidates(oldContent),
    };
}

/**
 * Find oldContent within the specified line range, allowing ±wiggle lines
 * for model off-by-one errors. Returns the actual matched range (1-based).
 */
function findOldContent(
    content: string,
    edit: PreparedEdit,
    wiggle: number,
):
    | { success: true; actualStart: number; actualEnd: number; matchedOldContent: string }
    | { success: false; error: string } {
    const lines = content.split('\n');
    const totalLines = lines.length;

    // Validate base range is sane
    if (edit.startLine < 1 || edit.endLine > totalLines || edit.startLine > edit.endLine) {
        return {
            success: false,
            error: `Invalid line range ${edit.startLine}-${edit.endLine}. Document has ${totalLines} lines.`,
        };
    }

    // Try exact range first, then expand ±1, ±2, ... up to wiggle
    for (let offset = 0; offset <= wiggle; offset++) {
        const starts = offset === 0 ? [edit.startLine] : [edit.startLine - offset, edit.startLine + offset];
        for (const start of starts) {
            const end = start + (edit.endLine - edit.startLine);
            if (start < 1 || end > totalLines) continue;

            const rangeLines = lines.slice(start - 1, end);
            const rangeContent = rangeLines.join('\n');

            for (const oldContent of edit.oldContentCandidates) {
                const matchIndex = rangeContent.indexOf(oldContent);
                if (matchIndex === -1) continue;

                // Check for ambiguity
                const secondMatch = rangeContent.indexOf(oldContent, matchIndex + 1);
                if (secondMatch !== -1) {
                    return {
                        success: false,
                        error: `Multiple matches for oldContent in lines ${start}-${end}. Edit is ambiguous.`,
                    };
                }

                return { success: true, actualStart: start, actualEnd: end, matchedOldContent: oldContent };
            }
        }
    }

    return {
        success: false,
        error: `oldContent not found in lines ${edit.startLine}-${edit.endLine} (±${wiggle}). Content may have changed.`,
    };
}

/** Atomic multi-edit: all validate first, then apply. Large earlier edits can shift later inputs past LINE_WIGGLE — prefer one big edit over several small ones across a collapsing region. */
export function applyEdits(content: string, edits: EditOperation[]): EditResult {
    let currentContent = normalizePatchNewlines(content);
    const preparedEdits = edits.map(prepareEdit);
    const appliedEdits: AppliedEdit[] = [];

    // Validate all edits first (atomic)
    for (const edit of preparedEdits) {
        const match = findOldContent(currentContent, edit, LINE_WIGGLE);
        if (!match.success) {
            return { success: false, error: match.error };
        }
    }

    // Apply all edits (now that validation passed)
    for (const edit of preparedEdits) {
        const match = findOldContent(currentContent, edit, LINE_WIGGLE);
        if (!match.success) {
            return { success: false, error: match.error };
        }

        const lines = currentContent.split('\n');
        const rangeLines = lines.slice(match.actualStart - 1, match.actualEnd);
        const rangeContent = rangeLines.join('\n');

        // Apply replacement
        const newRangeContent = rangeContent.replace(match.matchedOldContent, edit.newContent);

        appliedEdits.push({
            startLine: match.actualStart,
            endLine: match.actualEnd,
            oldContent: rangeContent,
            newContent: newRangeContent,
        });

        // Rebuild content
        const before = lines.slice(0, match.actualStart - 1);
        const after = lines.slice(match.actualEnd);
        currentContent = [...before, ...newRangeContent.split('\n'), ...after].join('\n');
    }

    return {
        success: true,
        newContent: currentContent,
        linesNow: countLines(currentContent),
        appliedEdits,
    };
}

// ============================================================================
// VERSION STATUS HELPERS
// ============================================================================

/**
 * Find the latest version with a specific status.
 */
export function findVersionByStatus(
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
    /** Whether this artifact is a read-only public resource (or imported from one) */
    isReadOnly: boolean;
    /** Whether this artifact is a PECP (auto-generated, cannot be edited directly) */
    isPECP: boolean;
}

/**
 * Find document by name within a scope (project or user) with version status info.
 */
export async function findDocumentByName(
    em: EntityManager,
    scope: DocumentScope,
    name: string,
): Promise<DocumentInfo | null> {
    const normalizedName = normalizeArtifactKey(name);

    const artifact = await em.findOne(
        ArtifactEntity,
        { ...scopeFilter(scope), key: normalizedName },
        { populate: ['current_version', 'versions'] },
    );

    if (!artifact) return null;

    const versions = artifact.versions.getItems();
    const proposed = versions.find((v) => v.status === 'proposed');
    const rejected = versions.filter((v) => v.status === 'rejected').sort((a, b) => b.version - a.version)[0];

    const currentContent = artifact.current_version?.content ?? null;
    const proposedContent = proposed?.content ?? null;
    const rejectedContent = rejected?.content ?? null;

    // Public artifacts and copies imported from public artifacts are read-only
    const isReadOnly = artifact.is_public || !!(artifact.metadata as any)?.importedFromPublic;

    return {
        id: artifact.id,
        name: artifact.key,
        title: proposed?.title ?? artifact.current_version?.title ?? '',
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
        isReadOnly,
        isPECP: !!(artifact as any).is_pecp,
    };
}

export interface DocumentListItem {
    name: string;
    title: string;
    lines: number;
    documentType: string;
    currentVersion: number | null;
    currentStatus: VersionStatus | null;
    latestVersion: number;
    latestStatus: VersionStatus;
    hasProposed: boolean;
    /** Whether this artifact is a read-only public resource (or imported from one) */
    isReadOnly: boolean;
}

/**
 * List all documents within a scope (project or user) with version status info.
 */
export async function listDocuments(
    em: EntityManager,
    scope: DocumentScope,
    filter?: { search?: string },
): Promise<DocumentListItem[]> {
    // TODO: Add search filter on name/title when needed

    const artifacts = await em.find(
        ArtifactEntity,
        {
            $and: [
                scopeFilter(scope),
                { is_pecp: false },
                { $or: [{ current_version: null }, { current_version: { status: { $ne: 'deleted' } } }] },
            ],
        } as any,
        { populate: ['current_version', 'versions'] },
    );

    return artifacts.map((a) => {
        const versions = a.versions.getItems();
        const latest = versions.sort((x, y) => y.version - x.version)[0];
        const proposed = versions.find((v) => v.status === 'proposed');

        const contentForLines = proposed?.content ?? a.current_version?.content ?? '';
        const isReadOnly = a.is_public || !!(a.metadata as any)?.importedFromPublic;

        return {
            name: a.key,
            title: proposed?.title ?? a.current_version?.title ?? '',
            lines: countLines(contentForLines),
            documentType: latest?.document_type ?? a.current_version?.document_type ?? 'Other',
            currentVersion: a.current_version?.version ?? null,
            currentStatus: a.current_version?.status ?? null,
            latestVersion: latest?.version ?? 0,
            latestStatus: latest?.status ?? 'approved',
            hasProposed: !!proposed,
            isReadOnly,
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
    scope: DocumentScope,
    chatId: string,
    name: string,
    title: string,
    content: string,
    is_internal = true,
    document_type = 'Other',
): Promise<{
    action: 'created' | 'proposed';
    artifactId: string;
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
        { ...scopeFilter(scope), key: normalizedName },
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
        newVersion.title = title;
        newVersion.content = content;
        newVersion.status = 'proposed';
        newVersion.is_internal = is_internal;
        newVersion.document_type = document_type as any;
        newVersion.status_changed_at = new Date();
        newVersion.chat = em.getReference('ChatEntity', chatId) as any;

        em.persist(newVersion);

        // Update artifact's version counter (but NOT current_version - that only changes on approval)
        existing.version = newVersionNum;

        await em.flush();

        return {
            action: 'proposed',
            artifactId: existing.id,
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
        let createdArtifactId = '';

        await em.transactional(async (txEm) => {
            // Phase 1: Create artifact (current_version will be NULL - nothing approved yet)
            const artifact = new ArtifactEntity();
            artifact.key = normalizedName;
            artifact.version = 1;
            setArtifactOwner(artifact, scope, txEm);
            // current_version stays null until first approval

            txEm.persist(artifact);
            await txEm.flush();
            createdArtifactId = artifact.id;

            // Phase 2: Create proposed version
            const version = new ArtifactVersionEntity();
            version.artifact = artifact;
            version.version = 1;
            version.title = title;
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
            artifactId: createdArtifactId,
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
