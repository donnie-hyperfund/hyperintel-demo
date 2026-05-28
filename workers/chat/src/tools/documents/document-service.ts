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
 * - current_version points to the latest actioned version (approved, rejected, or deleted)
 */

import type { EntityManager } from '@mikro-orm/core';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity, type VersionStatus } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { type ILockService, lock } from '@/workers/_common/util/locks';

// ============================================================================
// SCOPE — project-scoped or user-scoped artifacts
// ============================================================================

export type DocumentScope = { projectId: string } | { userId: string; chatId?: string };
export type DocumentDraftMode = 'create' | 'edit' | 'replace';

const DOCUMENT_LOCK_TTL_SECONDS = 30;
const DOCUMENT_LOCK_MAX_ATTEMPTS = 30;
const DOCUMENT_LOCK_POLL_MS = 1000;
const DOCUMENT_LOCK_RENEW_MS = (DOCUMENT_LOCK_TTL_SECONDS * 1000) / 2;

/** Build a MikroORM where-clause fragment from a scope. */
function scopeFilter(scope: DocumentScope): Record<string, unknown> {
    if ('projectId' in scope) return { project: scope.projectId };
    if (scope.chatId) return { $or: [{ user: scope.userId, project: null }, { chat: scope.chatId }] };
    return { user: scope.userId, project: null };
}

/** Set the owner (project or user) on a new artifact entity. */
function setArtifactOwner({
    artifact,
    scope,
    em,
}: {
    artifact: ArtifactEntity;
    scope: DocumentScope;
    em: EntityManager;
}) {
    if ('projectId' in scope) {
        artifact.project = em.getReference('ProjectEntity', scope.projectId) as any;
    } else {
        artifact.user = em.getReference('UserEntity', scope.userId) as any;
    }
}

function artifactLockScopePart(scope: DocumentScope): string {
    return 'projectId' in scope ? `project:${scope.projectId}` : `user:${scope.userId}`;
}

function artifactLockId(scope: DocumentScope, normalizedName: string): string {
    return `artifact:${artifactLockScopePart(scope)}:${normalizedName}`;
}

async function acquireArtifactKeyLock({
    lockService,
    lockId,
}: {
    lockService: ILockService;
    lockId: string;
}): Promise<number | false> {
    const acquired = await lock(
        lockService,
        lockId,
        null,
        DOCUMENT_LOCK_TTL_SECONDS,
        DOCUMENT_LOCK_MAX_ATTEMPTS,
        DOCUMENT_LOCK_POLL_MS,
    );
    return acquired ? acquired.lease : false;
}

async function withArtifactKeyLock<T>({
    lockService,
    scope,
    normalizedName,
    run,
}: {
    lockService: ILockService;
    scope: DocumentScope;
    normalizedName: string;
    run: () => Promise<T>;
}): Promise<T> {
    const lockId = artifactLockId(scope, normalizedName);
    const lease = await acquireArtifactKeyLock({ lockService, lockId });

    if (lease === false) {
        throw new Error(`Could not acquire document lock for "${normalizedName}". Please retry.`);
    }

    let finished = false;
    let renewTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRenewal = () => {
        renewTimer = setTimeout(() => {
            lock(lockService, lockId, lease, DOCUMENT_LOCK_TTL_SECONDS, 1, DOCUMENT_LOCK_POLL_MS)
                .then((renewed) => {
                    if (finished) return;
                    if (!renewed) {
                        console.error(`[document-service] document lock "${lockId}" could not be renewed`);
                        return;
                    }
                    scheduleRenewal();
                })
                .catch((err) => {
                    if (finished) return;
                    console.error(`[document-service] failed to renew document lock "${lockId}":`, err);
                });
        }, DOCUMENT_LOCK_RENEW_MS);
    };

    scheduleRenewal();

    try {
        return await run();
    } finally {
        finished = true;
        if (renewTimer) clearTimeout(renewTimer);
        try {
            await lockService.release(lockId, lease);
        } catch (err) {
            console.error(`[document-service] failed to release document lock "${lockId}":`, err);
        }
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

/** Line count after applyEdits splices `newRangeContent.split('\n')` — differs from countLines for `''` (1 vs 0). */
export function countReplacementLines(newRangeContent: string): number {
    return newRangeContent.split('\n').length;
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

/** Resolved edit — coords are resolved against the original content and emitted in replay-safe order. */
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

interface ResolvedEdit {
    actualStart: number;
    actualEnd: number;
    rangeContent: string;
    newRangeContent: string;
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

/** Atomic multi-edit: resolve all ranges against the original content, then apply bottom-up so line shifts never stale later edits. */
export function applyEdits(content: string, edits: EditOperation[]): EditResult {
    const originalContent = normalizePatchNewlines(content);
    const preparedEdits = edits.map(prepareEdit);
    const resolvedEdits: ResolvedEdit[] = [];

    for (const edit of preparedEdits) {
        const match = findOldContent(originalContent, edit, LINE_WIGGLE);
        if (!match.success) {
            return { success: false, error: match.error };
        }

        const lines = originalContent.split('\n');
        const rangeLines = lines.slice(match.actualStart - 1, match.actualEnd);
        const rangeContent = rangeLines.join('\n');
        const newRangeContent = rangeContent.replace(match.matchedOldContent, edit.newContent);

        resolvedEdits.push({
            actualStart: match.actualStart,
            actualEnd: match.actualEnd,
            rangeContent,
            newRangeContent,
        });
    }

    const sortedEdits = [...resolvedEdits].sort((leftEdit, rightEdit) => rightEdit.actualStart - leftEdit.actualStart);
    for (let i = 1; i < sortedEdits.length; i++) {
        const previous = sortedEdits[i - 1];
        const current = sortedEdits[i];
        if (current.actualEnd >= previous.actualStart) {
            return {
                success: false,
                error: `Overlapping edits in lines ${current.actualStart}-${current.actualEnd} and ${previous.actualStart}-${previous.actualEnd}.`,
            };
        }
    }

    let currentContent = originalContent;
    const appliedEdits: AppliedEdit[] = [];

    for (const resolved of sortedEdits) {
        const lines = currentContent.split('\n');
        const before = lines.slice(0, resolved.actualStart - 1);
        const after = lines.slice(resolved.actualEnd);
        currentContent = [...before, ...resolved.newRangeContent.split('\n'), ...after].join('\n');

        appliedEdits.push({
            startLine: resolved.actualStart,
            endLine: resolved.actualEnd,
            oldContent: resolved.rangeContent,
            newContent: resolved.newRangeContent,
        });
    }

    return {
        success: true,
        newContent: currentContent,
        linesNow: countLines(currentContent),
        appliedEdits,
    };
}

// ============================================================================
// TOOL RESULT ENRICHMENT (runner-side; no model-facing schema changes)
// ============================================================================

export interface TouchedRegion {
    startLine: number;
    endLine: number;
    content: string;
}

/** Context lines above/below each patched span in patch_document touched output. */
export const PATCH_TOUCHED_CONTEXT_LINES = 4;

/** ~10K tokens — generous cap; one fewer read_document still wins on cost. */
export const PATCH_TOUCHED_MAX_CHARS = 40_000;

/** begin_document(edit): all-or-nothing full draft when under cap. */
export const BEGIN_EDIT_MAX_LINES = 800;

/** ~15K tokens (chars/4 heuristic), paired with line cap — whichever binds first. */
export const BEGIN_EDIT_MAX_CHARS = 60_000;

export const BEGIN_EDIT_MAX_ESTIMATED_TOKENS = 15_000;

export function estimateTokensFromChars(chars: number): number {
    return Math.ceil(chars / 4);
}

/** True when the full loaded document can be returned in begin_document(edit/replace) without partial windows. */
export function draftFitsBeginContentCap(content: string): boolean {
    if (countLines(content) > BEGIN_EDIT_MAX_LINES) return false;
    const formatted = formatFullDraftContent(content);
    if (formatted.length > BEGIN_EDIT_MAX_CHARS) return false;
    if (estimateTokensFromChars(formatted.length) > BEGIN_EDIT_MAX_ESTIMATED_TOKENS) return false;
    return true;
}

export function formatFullDraftContent(content: string): string {
    return formatWithLineNumbers(content, 1);
}

function postEditSpansFromApplied(appliedEdits: AppliedEdit[]): { startLine: number; endLine: number }[] {
    const sorted = [...appliedEdits].sort((left, right) => left.startLine - right.startLine);
    let lineDelta = 0;

    return sorted.map((edit) => {
        const startLine = edit.startLine + lineDelta;
        const oldLineCount = edit.endLine - edit.startLine + 1;
        const newLineCount = countReplacementLines(edit.newContent);
        const endLine = startLine + newLineCount - 1;
        lineDelta += newLineCount - oldLineCount;
        return { startLine, endLine };
    });
}

function mergeLineRanges(ranges: { startLine: number; endLine: number }[]): { startLine: number; endLine: number }[] {
    if (!ranges.length) return [];

    const sorted = [...ranges].sort((left, right) => left.startLine - right.startLine);
    const merged: { startLine: number; endLine: number }[] = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = merged[merged.length - 1];
        if (current.startLine <= last.endLine + 1) {
            last.endLine = Math.max(last.endLine, current.endLine);
        } else {
            merged.push({ ...current });
        }
    }

    return merged;
}

/**
 * Build post-edit touched regions for patch_document tool results.
 * Line numbers and content use the same `N: ` prefix format as read_document.
 */
export function buildPatchTouchedRegions(
    finalContent: string,
    appliedEdits: AppliedEdit[],
    options?: { contextLines?: number; maxChars?: number },
): { touched: TouchedRegion[]; truncated: boolean } {
    if (!appliedEdits.length) return { touched: [], truncated: false };

    const contextLines = options?.contextLines ?? PATCH_TOUCHED_CONTEXT_LINES;
    const maxChars = options?.maxChars ?? PATCH_TOUCHED_MAX_CHARS;
    const totalLines = countLines(finalContent);
    if (totalLines === 0) return { touched: [], truncated: false };

    const expanded = postEditSpansFromApplied(appliedEdits)
        .map((span) => ({
            startLine: Math.max(1, span.startLine - contextLines),
            endLine: Math.min(totalLines, Math.max(span.endLine, span.startLine) + contextLines),
        }))
        .filter((span) => span.endLine >= span.startLine);

    const merged = mergeLineRanges(expanded);
    const touched: TouchedRegion[] = [];
    let charsUsed = 0;
    let truncated = false;

    for (const range of merged) {
        const viewport = extractViewport(finalContent, range.startLine, range.endLine);
        const entry: TouchedRegion = {
            startLine: viewport.startLine,
            endLine: viewport.endLine,
            content: viewport.content,
        };

        if (charsUsed + entry.content.length > maxChars) {
            truncated = true;
            break;
        }

        charsUsed += entry.content.length;
        touched.push(entry);
    }

    return { touched, truncated };
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
    /** artifact.current_version — the latest actioned version (approved, rejected, or deleted). */
    currentVersion: number | null;
    currentContent: string | null;
    currentStatus: VersionStatus | null;
    currentDocumentType: string | null;
    currentIsInternal: boolean | null;
    /** The most recent version with status 'approved'. May differ from current_version if a rejection happened after. */
    approvedVersion: number | null;
    approvedContent: string | null;
    approvedDocumentType: string | null;
    approvedIsInternal: boolean | null;
    /** The highest version number across all versions (artifact.version). */
    latestVersion: number;
    proposedVersion: number | null;
    proposedContent: string | null;
    proposedDocumentType: string | null;
    proposedIsInternal: boolean | null;
    rejectedVersion: number | null;
    rejectedContent: string | null;
    rejectedDocumentType: string | null;
    rejectedIsInternal: boolean | null;
    rejectionReason: string | null;
    lineCount: number;
    /** Whether this artifact is a read-only public resource (or imported from one) */
    isReadOnly: boolean;
}

function latestVersionWithStatus(
    versions: ArtifactVersionEntity[],
    status: VersionStatus,
): ArtifactVersionEntity | undefined {
    return versions
        .filter((version) => version.status === status)
        .sort((leftVersion, rightVersion) => rightVersion.version - leftVersion.version)[0];
}

function buildDocumentInfo(artifact: ArtifactEntity): DocumentInfo {
    const versions = artifact.versions.getItems();
    const proposed = latestVersionWithStatus(versions, 'proposed');
    const rejected = latestVersionWithStatus(versions, 'rejected');
    const lastApproved = latestVersionWithStatus(versions, 'approved');

    const currentContent = artifact.current_version?.content ?? null;
    const proposedContent = proposed?.content ?? null;
    const approvedContent = lastApproved?.content ?? null;

    const isReadOnly = artifact.is_public || !!(artifact.metadata as any)?.importedFromPublic;

    return {
        id: artifact.id,
        name: artifact.key,
        title: proposed?.title ?? artifact.current_version?.title ?? '',
        currentVersion: artifact.current_version?.version ?? null,
        currentContent,
        currentStatus: artifact.current_version?.status ?? null,
        currentDocumentType: artifact.current_version?.document_type ?? null,
        currentIsInternal: artifact.current_version?.is_internal ?? null,
        approvedVersion: lastApproved?.version ?? null,
        approvedContent,
        approvedDocumentType: lastApproved?.document_type ?? null,
        approvedIsInternal: lastApproved?.is_internal ?? null,
        latestVersion: artifact.version,
        proposedVersion: proposed?.version ?? null,
        proposedContent,
        proposedDocumentType: proposed?.document_type ?? null,
        proposedIsInternal: proposed?.is_internal ?? null,
        rejectedVersion: rejected?.version ?? null,
        rejectedContent: rejected?.content ?? null,
        rejectedDocumentType: rejected?.document_type ?? null,
        rejectedIsInternal: rejected?.is_internal ?? null,
        rejectionReason: rejected?.rejection_reason ?? null,
        lineCount: countLines(proposedContent ?? approvedContent ?? ''),
        isReadOnly,
    };
}

function hasPersistedVersions(artifact: ArtifactEntity): boolean {
    return artifact.versions.getItems().length > 0;
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
    if (!hasPersistedVersions(artifact)) return null;

    return buildDocumentInfo(artifact);
}

/**
 * Result of a `begin_document` version-slot reservation. The artifact-key worker lock
 * is held around the short reservation transaction, so concurrent calls on the
 * same key serialize and end up with distinct `reservedVersion` numbers (or a clean
 * collision error before any DB write happens).
 */
export type ReserveDraftVersionResult =
    | { kind: 'not-found' }
    | { kind: 'read-only'; existing: DocumentInfo }
    | { kind: 'collision'; existing: DocumentInfo }
    | {
          kind: 'reserved';
          artifactId: string;
          existing: DocumentInfo | null;
          reservedVersion: number;
          wasDeleted: boolean;
      };

function artifactHasNoVersions(artifact: ArtifactEntity): boolean {
    return artifact.versions.getItems().length === 0;
}

export interface ReserveDraftVersionOptions {
    em: EntityManager;
    lockService: ILockService;
    scope: DocumentScope;
    name: string;
    mode: DocumentDraftMode;
}

/**
 * Serialize concurrent `begin_document` calls on the same artifact key and atomically
 * reserve the next version slot.
 *
 * Strategy: a worker-safe LocksService lock keyed by `${scope}:${name}` serializes
 * parallel callers before any DB transaction starts. Under the lock:
 *   - mode='create' with no existing row → insert ArtifactEntity with `version = 1`,
 *     return `{ reservedVersion: 1 }` (no ArtifactVersion row created — finalize_document
 *     writes that, abort path cleans the empty artifact up via cleanupOrphanArtifact).
 *   - mode='create' on a non-deleted existing artifact → `{ kind: 'collision' }`.
 *   - mode='edit' | 'replace', or mode='create' on a deleted artifact → bump
 *     `artifact.version` counter and return the new value as `reservedVersion`.
 */
export async function reserveDraftVersion(opts: ReserveDraftVersionOptions): Promise<ReserveDraftVersionResult> {
    const { em, lockService, scope, name, mode } = opts;
    const normalizedName = normalizeArtifactKey(name);

    return withArtifactKeyLock({
        lockService,
        scope,
        normalizedName,
        run: () =>
            em.transactional(async (txEm) => {
                const artifact = await txEm.findOne(
                    ArtifactEntity,
                    { ...scopeFilter(scope), key: normalizedName },
                    { populate: ['current_version', 'versions'] },
                );

                if (!artifact) {
                    if (mode === 'edit' || mode === 'replace') {
                        return { kind: 'not-found' };
                    }
                    const created = new ArtifactEntity();
                    created.key = normalizedName;
                    created.version = 1;
                    setArtifactOwner({ artifact: created, scope, em: txEm });
                    txEm.persist(created);
                    await txEm.flush();
                    return {
                        kind: 'reserved',
                        artifactId: created.id,
                        existing: null,
                        reservedVersion: 1,
                        wasDeleted: false,
                    };
                }

                if (artifactHasNoVersions(artifact)) {
                    txEm.remove(artifact);
                    await txEm.flush();

                    if (mode === 'edit' || mode === 'replace') {
                        return { kind: 'not-found' };
                    }

                    const created = new ArtifactEntity();
                    created.key = normalizedName;
                    created.version = 1;
                    setArtifactOwner({ artifact: created, scope, em: txEm });
                    txEm.persist(created);
                    await txEm.flush();
                    return {
                        kind: 'reserved',
                        artifactId: created.id,
                        existing: null,
                        reservedVersion: 1,
                        wasDeleted: false,
                    };
                }

                const info = buildDocumentInfo(artifact);

                if (info.isReadOnly) {
                    return { kind: 'read-only', existing: info };
                }

                const isDeleted = info.currentStatus === 'deleted';
                if (mode === 'create' && !isDeleted) {
                    return { kind: 'collision', existing: info };
                }

                const reservedVersion = artifact.version + 1;
                artifact.version = reservedVersion;
                await txEm.flush();
                return {
                    kind: 'reserved',
                    artifactId: artifact.id,
                    existing: info,
                    reservedVersion,
                    wasDeleted: isDeleted,
                };
            }),
    });
}

export interface CleanupOrphanArtifactOptions {
    em: EntityManager;
    lockService: ILockService;
    scope: DocumentScope;
    name: string;
}

/**
 * Remove an ArtifactEntity that has no persisted ArtifactVersion rows. Called from
 * finalize_document's abort path so the empty slot created by reserveDraftVersion
 * for mode='create' on a brand-new key doesn't linger as a phantom in list_documents.
 *
 * Returns `true` if a row was removed, `false` if the artifact already had versions
 * (intentionally not deleted) or wasn't found.
 */
export async function cleanupOrphanArtifact(opts: CleanupOrphanArtifactOptions): Promise<boolean> {
    const { em, lockService, scope, name } = opts;
    const normalizedName = normalizeArtifactKey(name);

    return withArtifactKeyLock({
        lockService,
        scope,
        normalizedName,
        run: () =>
            em.transactional(async (txEm) => {
                const artifact = await txEm.findOne(
                    ArtifactEntity,
                    { ...scopeFilter(scope), key: normalizedName },
                    { populate: ['versions'], refresh: true },
                );
                if (!artifact) return false;
                if (artifact.versions.getItems().length > 0) return false;
                txEm.remove(artifact);
                await txEm.flush();
                return true;
            }),
    });
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
                { $or: [{ current_version: null }, { current_version: { status: { $ne: 'deleted' } } }] },
            ],
        } as any,
        { populate: ['current_version', 'versions'] },
    );

    return artifacts.flatMap((artifact): DocumentListItem[] => {
        const versions = artifact.versions.getItems();
        if (!hasPersistedVersions(artifact)) return [];

        const latest = [...versions].sort((leftVersion, rightVersion) => rightVersion.version - leftVersion.version)[0];
        const proposed = latestVersionWithStatus(versions, 'proposed');

        const contentForLines = proposed?.content ?? artifact.current_version?.content ?? '';
        const isReadOnly = artifact.is_public || !!(artifact.metadata as any)?.importedFromPublic;

        return [
            {
                name: artifact.key,
                title: proposed?.title ?? artifact.current_version?.title ?? '',
                lines: countLines(contentForLines),
                documentType: latest.document_type,
                currentVersion: artifact.current_version?.version ?? null,
                currentStatus: artifact.current_version?.status ?? null,
                latestVersion: latest.version,
                latestStatus: latest.status,
                hasProposed: !!proposed,
                isReadOnly,
            },
        ];
    });
}

export interface UpsertDocumentOptions {
    em: EntityManager;
    lockService: ILockService;
    scope: DocumentScope;
    chatId: string;
    name: string;
    title: string;
    content: string;
    is_internal?: boolean;
    document_type?: string;
    /** Version number reserved by reserveDraftVersion. The new ArtifactVersion row is persisted at exactly this number. */
    reservedVersion: number;
}

export interface UpsertDocumentResult {
    action: 'created' | 'proposed';
    status: 'proposed' | 'superseded';
    artifactId: string;
    name: string;
    version: number;
    versionId: string;
    lines: number;
    supersededVersion?: number;
    supersededByVersion?: number;
    supersededContent?: string | null;
    supersededSummaryInternal?: string | null;
}

/**
 * Persist a finalized draft as a new ArtifactVersion row using the version number
 * already reserved by reserveDraftVersion.
 *
 * Invariant: the parent ArtifactEntity must already exist — reserveDraftVersion creates
 * it for mode='create' or bumps the counter for edit/replace.
 *
 * Concurrent edit/replace streams can finalize out of reservation order. The highest
 * reserved version remains the active proposed version; an older stream that finishes
 * later is saved as superseded instead of overriding a newer proposed version.
 */
export async function upsertDocument(opts: UpsertDocumentOptions): Promise<UpsertDocumentResult> {
    const {
        em,
        lockService,
        scope,
        chatId,
        name,
        title,
        content,
        is_internal = true,
        document_type = 'Other',
        reservedVersion,
    } = opts;
    const normalizedName = normalizeArtifactKey(name);
    const lineCount = countLines(content);

    return withArtifactKeyLock({
        lockService,
        scope,
        normalizedName,
        run: () =>
            em.transactional(async (txEm) => {
                const existing = await txEm.findOne(
                    ArtifactEntity,
                    { ...scopeFilter(scope), key: normalizedName },
                    { populate: ['current_version', 'versions'], refresh: true },
                );

                if (!existing) {
                    throw new Error(
                        `Cannot finalize "${normalizedName}": parent artifact row missing. begin_document should have reserved a version slot first.`,
                    );
                }

                const versions = existing.versions.getItems();
                const wasFirstVersion = versions.length === 0;

                const existingProposed = latestVersionWithStatus(versions, 'proposed');
                const shouldSupersedeExisting =
                    existingProposed !== undefined && existingProposed.version < reservedVersion;
                const supersededVersion = shouldSupersedeExisting ? existingProposed.version : undefined;
                const supersededContent = shouldSupersedeExisting ? (existingProposed?.content ?? null) : null;
                const supersededSummaryInternal = shouldSupersedeExisting
                    ? (existingProposed?.summary_internal ?? null)
                    : null;
                const supersededByVersion =
                    existingProposed !== undefined && existingProposed.version > reservedVersion
                        ? existingProposed.version
                        : undefined;
                const newStatus: 'proposed' | 'superseded' =
                    supersededByVersion === undefined ? 'proposed' : 'superseded';

                if (shouldSupersedeExisting) {
                    existingProposed.status = 'superseded';
                    existingProposed.rejection_reason = `Superseded by v${reservedVersion}`;
                    existingProposed.status_changed_at = new Date();
                }

                const newVersion = new ArtifactVersionEntity();
                newVersion.artifact = existing;
                newVersion.version = reservedVersion;
                newVersion.title = title;
                newVersion.content = content;
                newVersion.status = newStatus;
                if (supersededByVersion !== undefined) {
                    newVersion.rejection_reason = `Superseded by v${supersededByVersion}`;
                }
                newVersion.is_internal = is_internal;
                newVersion.document_type = document_type as any;
                newVersion.status_changed_at = new Date();
                newVersion.chat = txEm.getReference('ChatEntity', chatId) as any;
                txEm.persist(newVersion);

                // artifact.version was already bumped during reservation. Stay defensive against
                // out-of-order finalize calls (e.g. a later reservation finalizing before an earlier one).
                if (existing.version < reservedVersion) {
                    existing.version = reservedVersion;
                }

                await txEm.flush();

                return {
                    action: wasFirstVersion ? 'created' : 'proposed',
                    status: newStatus,
                    artifactId: existing.id,
                    name: normalizedName,
                    version: reservedVersion,
                    versionId: newVersion.id,
                    lines: lineCount,
                    ...(supersededVersion !== undefined && { supersededVersion }),
                    ...(supersededByVersion !== undefined && { supersededByVersion }),
                    supersededContent,
                    supersededSummaryInternal,
                };
            }),
    });
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
