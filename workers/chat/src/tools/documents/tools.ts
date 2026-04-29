/**
 * Document Tools - Multi-Call Architecture
 *
 * Tools for managing documents using a begin → write/edit → finalize pattern.
 * This design leverages sequential tool streaming for optimal UX.
 *
 * Flow:
 * 1. begin_document(mode, name, title?) → creates editing draft (in-memory)
 * 2. write_document(content) or patch_document(edits) → modify draft
 * 3. finalize_document() → saves as proposed version (awaiting approval)
 *
 * Versioning:
 * - finalize_document creates a "proposed" version (not immediately live)
 * - User approves via UI → becomes "approved" (live)
 * - If agent finalizes again before approval → old proposed becomes "superseded"
 */

import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import type { QueueAdapter } from '@common/common/queue.adapter';
import type { EntityManager } from '@mikro-orm/core';
import { z } from 'zod';
import { hydrateArtifactImages } from '@/lib/artifacts/artifact-images';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { DocumentTypeSchema, INTERNAL_DOCUMENTS } from '@/lib/schema/artifact';
import { approveArtifactHandler, rejectArtifactHandler } from '../../artifact-approver';
import type { Ctx } from '../../context';
import { shouldGenerateAiContent } from './document-classifier';
import {
    applyEdits,
    countLines,
    type DocumentListItem,
    type DocumentScope,
    type EditOperation,
    extractViewport,
    findDocumentByName,
    findVersionByStatus,
    listDocuments as listDocumentsDb,
    upsertDocument,
} from './document-service';
import { DraftManager } from './draft-manager';
import { pecpKeyForDocument, shouldGeneratePECP } from './pecp-service';

// ============================================================================
// TYPES
// ============================================================================

export interface DocumentToolsContext {
    /** Entity manager for DB operations */
    em: EntityManager;
    /** Project scope — set for project chats */
    projectId?: string;
    /** User scope — set for user-level chats (intake) */
    userId?: string;
    /** Current chat ID (for traceability) */
    chatId: string;
    /** Draft manager instance */
    draftManager: DraftManager;
    /** Embedding queue adapter for async indexing (optional) */
    embeddingQueue?: QueueAdapter;
    /** Preview branch alias for queue messages (so downstream workers connect to the correct DB branch) */
    previewAlias?: string | null;
    /** Version IDs created during this turn - will be linked to assistant message after persist */
    createdVersionIds: string[];
    /** Set by finalize_document when an internal doc needs a PECP generated next */
    pendingPECP?: { parentDocument: string; parentDocumentType: string; pecpKey: string } | null;
    /** Optional callback fired when a new artifact version is created (for user-scoped broadcasts) */
    onVersionCreated?: (event: {
        artifactName: string;
        versionId: string;
        version: number;
        action: 'created' | 'proposed';
        documentType?: string | null;
    }) => void;
}

/** Derive DocumentScope from context. */
function getScope(ctx: DocumentToolsContext): DocumentScope {
    if (ctx.projectId) return { projectId: ctx.projectId };
    if (ctx.userId) return { userId: ctx.userId, chatId: ctx.chatId };
    throw new Error('DocumentToolsContext requires either projectId or userId');
}

// ============================================================================
// TOOL GROUP
// ============================================================================

const PATCH_DOCUMENT_ALLOW_EXPLICIT_END_LINE = false;

export const DocumentToolGroup: AgentToolGroup = {
    name: 'Document Management',
    slug: 'document_',
    description: 'Tools for creating, reading, and editing documents with version control.',
    guidance: `## Workflow
1. \`begin_document\` - Start editing (auto-loads best version to work from)
2. \`write_document\` / \`patch_document\` - Make changes
3. \`finalize_document\` - Save (MUST call or content is lost)

## Editing Strategy
- For existing-document patch edits, use this sequence: \`begin_document(mode="edit")\` → \`read_document\` if you need exact current lines → \`patch_document\` → \`finalize_document\`.
- If you authored or patched this document earlier in the same conversation, skip \`read_document\` and patch directly — your own content is authoritative.
- Never call \`patch_document\` before \`begin_document\`; patches edit only the active draft.
- \`patch_document\` edits are **atomic and verified** — the tool confirms success. Do NOT re-read a document after patching to check your work.
- when using \`patch_document\` make sure the fields in your JSON output are properly escaped. JSON does not allow plain newlines for example - the tool call will fail to parse.
- \`read_document\` output prefixes each line with \`N: \` (e.g. \`5: some text\`) for orientation. This prefix is DISPLAY ONLY — do NOT include it in \`oldContent\` when patching. Copy only the actual line text that comes after \`N: \`.
${PATCH_DOCUMENT_ALLOW_EXPLICIT_END_LINE ? '- For `patch_document` edits, provide `startLine`, `oldContent`, and `newContent`; `endLine` is optional and only narrows the search window.' : '- For `patch_document` edits, provide exactly `startLine`, `oldContent`, and `newContent`. The replacement span is inferred from `oldContent`.'}
- Batch independent pending edits into a single \`patch_document\` call. If an edit heavily changes line counts above later edits, prefer one larger edit covering the affected section, or split only when later edits have stable nearby anchors.
- If you need to rewrite most of a document (>50% changing), use \`write_document\` to replace the entire content instead of many patches.
- The pattern \`read → patch → read → patch\` is a wasteful anti-pattern. Read once, patch once (with all edits), finalize.

## Document Statuses
- \`proposed\`: Saved, awaiting user approval
- \`approved\`: Live version users see
- \`rejected\`: User rejected with feedback - revise it
- \`superseded\`: You saved a newer version before previous was approved

## Approval & Rejection
\`finalize_document\` saves as "proposed". User approves via UI or chat to make it live ("approved").
If you finalize again before approval, old proposed becomes "superseded".

**CRITICAL: \`approve_document\` and \`reject_document\` are USER-INITIATED ONLY.**
NEVER call these tools on your own initiative. Only use them when the user indicates approval or rejection in chat.
After creating or finalizing a document, do NOT automatically approve it — wait for the user's decision.

**STATUS CONSTRAINTS FOR APPROVAL:**
- \`approve_document\` ONLY works on documents with a "proposed" version. It will FAIL for documents in any other status.
- If a document was previously **rejected**, it CANNOT be approved directly. You must revise it first: \`begin_document\` → edit → \`finalize_document\` to create a new "proposed" version, then the user can approve that.
- If \`approve_document\` or \`reject_document\` returns an error, NEVER pretend the operation succeeded. Do NOT expose internal error details or statuses to the user. Instead, communicate naturally (e.g., "This document needs to be revised before I can approve it — let me update it for you.") and proactively take the recovery action (revise the document).

### System events (UI-initiated actions)
When the user approves, rejects, or restores a document via the UI (not chat), you will receive a \`<system>\` tagged message like:
- \`<system>User has approved artifact [document-name.md] v2</system>\`
- \`<system>User has rejected artifact [document-name.md] v2. Reason: ...</system>\`
- \`<system>User has restored artifact [document-name.md] v1 as proposed v3 (awaiting approval)</system>\`

**When you see a \`<system>\` event:**
- For approvals and rejections, the action has ALREADY been performed — do NOT call \`approve_document\`, \`reject_document\`, or \`list_documents\` to verify.
- Do NOT call ANY document tools (begin_document, write_document, finalize_document, etc.) in response to a system event unless the user explicitly asks you to, **except** for the read described below for restores.
- For approvals: briefly confirm the approval. Do NOT start generating the next document, phase, or any content. Simply ask the user what they'd like to do next.
- For rejections: read the reason and ask the user if they'd like you to revise. Do NOT start revising automatically.
- For restores: the user has reverted to an earlier version via the version history panel. The selected content has been saved as a new PROPOSED version — it is NOT yet live and is awaiting the user's decision. Use \`read_document\` with \`version="proposed"\` to read the restored content, then include a \`::document[name]{version=N lines=L}\` directive in your response (using the \`name\`, \`version\`, and \`totalLines\` from the \`read_document\` result) so the artifact indicator appears in the conversation. Briefly acknowledge and ask what the user would like to do. Do NOT preemptively call \`approve_document\` or \`reject_document\` on your own initiative — but a restored proposed version is approved/rejected the same way as any other proposed version: the user may click approve/reject in the UI, or signal it in their next chat message (in which case follow the normal chat-based approval rules below and call \`approve_document\`/\`reject_document\`), or ask you to revise it further (in which case follow the normal begin_document → edit → finalize_document flow).

### Detecting approval/rejection intent (chat messages only)
When a **regular** user message (not a \`<system>\` event) contains approval or rejection signals, you MUST process them BEFORE acting on any other part of the message.
- **Approval signals:** "approved", "looks good", "accept", "approve it", "LGTM", "ship it", "all good", "proceed" (when a proposed document is pending), or similar positive confirmation.
- **Rejection signals:** "reject", "redo", "not good", "change X", "needs work", or explicit revision requests for a pending proposed document.
- **Compound messages:** If the user says something like "approved, now do X" or "looks good, proceed with Y" — FIRST call \`approve_document\` for the pending document, THEN proceed with the rest of the request.
- **Ambiguity:** If it's unclear whether the user is approving or just continuing, and there IS a pending proposed document, ask for clarification before proceeding.

## Important
\`list_documents\` and \`read_document\` are for viewing specific documents. Use \`search_knowledge\` to find relevant context via semantic search across all approved documents.

## Finding Documents / Files
When the user asks about a specific file or document (e.g., "what's in the UX doc?", "check the analysis file"):
1. **First** use \`search_knowledge\` with a relevant query — this searches by semantic similarity across all approved documents.
2. If \`search_knowledge\` returns no relevant results, use \`list_documents\` to browse available documents and find the right name.
3. Then use \`read_document\` with the exact document name to view its full content.
Never skip straight to \`read_document\` with a guessed name — always discover the correct name first via search or listing.

## PECP — PE Communication Protocol (MANDATORY)
After finalizing any internal document, finalize_document will instruct you to generate a PECP.
The PECP is the PE-facing communication for the deliverable — use the PECP stage templates from your loaded prompts (Identity Framework Part 10).
**This is the ONE exception to the "no proactive documents" rule.** When finalize_document returns \`pecpRequired\`, you MUST immediately:
1. Call \`begin_document\` with the exact name, document_type="PECP", and parent_document as specified
2. Write the PECP using the appropriate stage template from your system prompt
3. Call \`finalize_document\` — the PECP will be auto-approved
After the PECP is finalized, STOP and wait for the user.

## Proactive Actions (FORBIDDEN)
**NEVER create documents the user did not explicitly request** (except PECPs as described above). After an approval, rejection, or restore (whether via chat or \`<system>\` event), STOP and wait for the user's next message. Do NOT:
- Automatically start creating "the next logical document"
- Generate follow-up content without being asked
- Chain approvals into new document creation
- Anticipate what the user "probably wants next"
- Call any document tools (begin_document, write_document, finalize_document, etc.) unless the user explicitly asks
- Mention "Phase 2", "next step", or suggest what comes next — let the user drive the workflow
Only create, edit, or finalize documents when the user explicitly asks for them in their message.`,
    behavioralGuidance: `NEVER re-read a document after patching — patches are atomic and confirmed. If you authored or patched this document earlier in the same conversation, skip read_document and patch directly — your own content is authoritative. Before patching an existing document, call begin_document(mode="edit") so there is an active draft. ${PATCH_DOCUMENT_ALLOW_EXPLICIT_END_LINE ? 'Patch edits may include optional endLine only to narrow the search window.' : 'Patch edits have exactly three fields: startLine, oldContent, and newContent.'} When copying text from read_document into oldContent, strip the leading "N: " line-number prefix — it is display-only and must not appear in oldContent. Batch independent edits into a single patch_document call. When an earlier edit heavily shifts later line numbers, prefer one larger edit covering the affected section, or split only when later edits have stable nearby anchors. If rewriting most of a document, use write_document instead of many patches. Do NOT include meta-labels like "AI Readable Specification" or "Machine Readable Format" in documents — write clean, professional content. When a REGULAR user message (not a <system> event) contains approval/rejection signals AND a proposed document is pending, ALWAYS call approve_document or reject_document FIRST before handling other requests in the same message. CRITICAL: When you receive a <system> event indicating an artifact was approved or rejected, the action is ALREADY DONE — do NOT call approve_document or reject_document again, do NOT call any document tools, and do NOT start generating next documents or phases. Just briefly acknowledge and wait for the user to tell you what to do next. CRITICAL: When you receive a <system> event indicating a RESTORE, the selected content has been saved as a new PROPOSED version awaiting the user's decision — it is NOT live and the action is NOT complete. Use read_document with version="proposed" to read the restored content, include a ::document[name]{version=N lines=L} directive in your response (using name, version, and totalLines from read_document), briefly acknowledge, and ask what the user wants to do. Do NOT preemptively call approve_document or reject_document on your own initiative — the restored proposed version is approved/rejected the same way as any other proposed version: via UI, or by the user signaling it in their next chat message (in which case follow the normal chat-based approval protocol and call approve_document/reject_document). CRITICAL: approve_document ONLY works on "proposed" documents. If a document is rejected/approved/superseded, do NOT attempt to approve it — revise it first (begin_document → edit → finalize_document) to create a new proposed version, then approve. If approve_document or reject_document returns an error, NEVER claim success and NEVER expose raw error details or internal statuses to the user — communicate naturally and take the recovery action. CRITICAL: NEVER proactively create, write, or finalize documents that the user did not explicitly request — EXCEPT when finalize_document returns pecpRequired. In that case, you MUST immediately generate the PECP using begin_document → write_document → finalize_document with the specified parameters. After the PECP is done, STOP. After approving, rejecting, or restoring a document, STOP and wait for the user's next instruction — do NOT automatically start creating the next document, generate follow-up content, or take any action beyond confirming the action. Only create documents when the user explicitly asks for them.`,
    tools: [
        'begin_document',
        'write_document',
        'patch_document',
        'finalize_document',
        'read_document',
        'list_documents',
        'search_knowledge',
        'approve_document',
        'reject_document',
    ],
};

// ============================================================================
// SCHEMAS
// ============================================================================

const BeginDocumentParams = z.object({
    mode: z
        .enum(['create', 'edit'])
        .describe(
            'Operation mode: "create" (new document, fails if exists), "edit" (modify existing, loads best version to edit)',
        ),
    name: z.string().min(1).describe('Document name (e.g., "analysis.md"). Extension auto-appended if missing.'),
    title: z.string().optional().nullable().describe('Display title for the document (required for create).'),
    document_type: DocumentTypeSchema.describe(
        'Classification of the document type. Must be one of the allowed types. The type determines whether the document is internal (hidden from the user) or a client deliverable (visible) — no separate flag is needed. In edit mode, you should generally keep the same value as the existing version.',
    ),
    parent_document: z
        .string()
        .optional()
        .nullable()
        .describe(
            "Required for PECP document_type: the name of the parent internal document this PECP summarizes. The PECP will be linked to the parent's latest proposed version.",
        ),
});

const WriteDocumentParams = z.object({
    content: z.string().describe('Content to append to the current editing draft.'),
});

const PatchDocumentParams = z.object({
    edits: z
        .array(
            z.object({
                startLine: z.number().int().positive().describe('Starting line anchor (1-indexed).'),
                ...(PATCH_DOCUMENT_ALLOW_EXPLICIT_END_LINE
                    ? {
                          endLine: z
                              .number()
                              .int()
                              .positive()
                              .optional()
                              .nullable()
                              .describe(
                                  'End of search range (inclusive). Optional; inferred from oldContent line count when omitted.',
                              ),
                      }
                    : {}),
                oldContent: z.string().describe('Exact content to find and replace near startLine.'),
                newContent: z.string().describe('Replacement content.'),
            }),
        )
        .min(1)
        .describe('List of edit operations to apply atomically.'),
});

const FinalizeDocumentParams = z.object({});

const ReadDocumentParams = z.object({
    name: z.string().min(1).describe('Document name to read.'),
    version: z
        .enum(['approved', 'proposed', 'latest'])
        .default('latest')
        .describe('Which version to read: "approved" (live), "proposed" (pending approval), "latest" (most recent).'),
    startLine: z.number().int().positive().optional().nullable().describe('First line to return (1-indexed).'),
    endLine: z.number().int().positive().optional().nullable().describe('Last line to return (inclusive).'),
    skipImages: z.boolean().optional().default(false).describe('Skip embedded images and return text only.'),
});

const ListDocumentsParams = z.object({
    search: z.string().optional().nullable().describe('Optional filter by name/title substring.'),
    silent: z
        .boolean()
        .optional()
        .nullable()
        .describe(
            'If true, suppresses document cards in the UI. Use when checking documents internally (e.g. before editing). Default: false.',
        ),
});

const ApproveDocumentParams = z.object({
    name: z.string().min(1).describe('Document name to approve (e.g., "analysis.md").'),
});

const RejectDocumentParams = z.object({
    name: z.string().min(1).describe('Document name to reject (e.g., "analysis.md").'),
    reason: z.string().min(1).describe('Reason for rejection - feedback for the author on what needs to change.'),
});

// ============================================================================
// TOOL FACTORY
// ============================================================================

export function createDocumentTools() {
    return [
        // ----------------------------------------------------------------
        // begin_document - Start editing draft session
        // ----------------------------------------------------------------
        {
            name: 'begin_document' as const,
            description: `Start a document editing draft session.

Modes:
- "create": Create new document (fails if exists)
- "edit": Edit existing document - automatically loads the best version:
  • If proposed version exists → loads it (continue your pending work)
  • If rejected version exists → loads it with rejection reason (revise it)
  • Otherwise → loads approved version (start new changes)

Document Type (also controls visibility):
- Classify the document with the appropriate document_type.
- Internal working documents (Genesis DNA, Legacy DNA, Team Specification, MID, PSEB, Action Plan, Completion Brief, Company Profile, Human Persona) are hidden from the user.
- All other types (Research Report, Executive Summary, PECP, Other) are client-visible deliverables.
- In edit mode, you should generally keep the same document_type as the existing version.

After calling this, use write_document to add content or patch_document for precise edits.
You MUST call finalize_document when done or content will be lost.`,
            parameters: BeginDocumentParams,
            executor: async (input: z.infer<typeof BeginDocumentParams>, ctx: DocumentToolsContext) => {
                const { mode, name, title, document_type, parent_document } = input;
                const { em, draftManager } = ctx;
                const scope = getScope(ctx);
                const scopeId = ctx.projectId ?? ctx.userId!;

                // Internal/deliverable visibility is derived solely from document_type.
                const is_internal = (INTERNAL_DOCUMENTS as readonly string[]).includes(document_type);

                const isPECP = document_type === 'PECP';

                // PECP validation: must have parent_document, must be create mode
                if (isPECP) {
                    if (!parent_document) {
                        return {
                            error: 'PECP documents require parent_document — the name of the internal document to summarize.',
                        };
                    }
                    if (mode !== 'create') {
                        return { error: 'PECP documents can only be created (mode="create"), not edited.' };
                    }
                }

                // Resolve parent version for PECP
                let parentVersionId: string | undefined;
                if (isPECP && parent_document) {
                    const parentNormalized = normalizeArtifactKey(parent_document);
                    const parentDoc = await findDocumentByName(em, scope, parentNormalized);
                    if (!parentDoc) {
                        return { error: `Parent document "${parentNormalized}" not found.` };
                    }
                    // Find the latest proposed or approved version (covers both chat and summarizer flows)
                    const parentVersion = await em.findOne(
                        ArtifactVersionEntity,
                        { artifact: parentDoc.id, status: { $in: ['proposed', 'approved'] } },
                        { orderBy: { version: 'DESC' } },
                    );
                    if (!parentVersion) {
                        return { error: `Parent document "${parentNormalized}" has no version to summarize.` };
                    }
                    parentVersionId = parentVersion.id;
                }

                const normalizedName = normalizeArtifactKey(name);

                // Check for existing document
                const existing = await findDocumentByName(em, scope, normalizedName);

                // Block editing of read-only (public) artifacts
                if (existing?.isReadOnly) {
                    return {
                        error: `Document "${normalizedName}" is a read-only public resource and cannot be edited. You can only read it using read_document.`,
                    };
                }

                // Block direct editing of PECP artifacts — they are auto-generated from parent docs
                if (existing?.isPECP && !isPECP) {
                    return {
                        error: `Document "${normalizedName}" is a PECP (auto-generated PE Communication). It cannot be edited directly — edit the parent internal document instead, and a new PECP will be generated automatically.`,
                    };
                }

                // Validate based on mode
                // Allow create on deleted artifacts (overwrites / restores them)
                // Allow create on PECP artifacts (they get replaced with each new parent version)
                const isDeleted = existing?.currentStatus === 'deleted';
                if (mode === 'create' && existing && !isDeleted && !isPECP) {
                    return {
                        error: `Document "${normalizedName}" already exists. Use mode="edit" to modify it.`,
                    };
                }
                if (mode === 'edit' && !existing) {
                    return {
                        error: `Document "${normalizedName}" does not exist. Use mode="create" for new documents.`,
                    };
                }

                // Handle CREATE mode
                if (mode === 'create') {
                    const docTitle = title || normalizedName;
                    try {
                        const draft = draftManager.begin(
                            scopeId,
                            normalizedName,
                            docTitle,
                            isPECP && existing ? 'replace' : mode,
                            '',
                            undefined,
                            is_internal,
                            document_type,
                            parentVersionId,
                        );
                        return {
                            status: 'editing',
                            mode: 'create',
                            name: normalizedName,
                            title: draft.title,
                            is_internal: draft.is_internal,
                            document_type: draft.document_type,
                            lines: 0,
                            ...(isPECP &&
                                parent_document && {
                                    isPECP: true,
                                    parentDocument: normalizeArtifactKey(parent_document),
                                }),
                            ...(isDeleted && { previouslyDeleted: true }),
                            message: isDeleted
                                ? `Document "${normalizedName}" was previously deleted. Creating fresh content. Finalize to save.`
                                : 'Draft started. Use write_document to add content, then finalize_document.',
                        };
                    } catch (err: any) {
                        return { error: err.message };
                    }
                }

                // Handle EDIT mode - load best version based on status
                const docTitle = title || existing!.title;
                let contentToLoad: string;
                let loadedFrom: string;
                let loadedVersion: number | null;
                let existingDocumentType: string | null = null;
                let rejectionReason: string | null = null;

                if (existing!.proposedVersion !== null && existing!.proposedContent !== null) {
                    contentToLoad = existing!.proposedContent;
                    loadedFrom = 'proposed';
                    loadedVersion = existing!.proposedVersion;
                    existingDocumentType = existing!.proposedDocumentType;
                } else if (existing!.approvedContent !== null) {
                    contentToLoad = existing!.approvedContent;
                    loadedFrom = isDeleted ? 'deleted' : 'approved';
                    loadedVersion = existing!.approvedVersion;
                    existingDocumentType = existing!.approvedDocumentType;
                } else if (existing!.rejectedVersion !== null && existing!.rejectedContent !== null) {
                    contentToLoad = existing!.rejectedContent;
                    loadedFrom = 'rejected';
                    loadedVersion = existing!.rejectedVersion;
                    existingDocumentType = existing!.rejectedDocumentType;
                    rejectionReason = existing!.rejectionReason;
                } else {
                    return { error: 'No version available to edit.' };
                }

                try {
                    const draft = draftManager.begin(
                        scopeId,
                        normalizedName,
                        docTitle,
                        mode,
                        contentToLoad,
                        loadedVersion ?? undefined,
                        is_internal,
                        document_type,
                    );

                    const messages: Record<string, string> = {
                        proposed: `Continuing proposed v${loadedVersion}. Make changes, then finalize_document.`,
                        rejected: `Revising rejected v${loadedVersion}. Address feedback, then finalize_document.`,
                        approved: `Editing from approved v${loadedVersion}. Make changes, then finalize_document.`,
                        deleted: `Document was deleted (v${loadedVersion}). Loaded deleted content. Finalizing will restore it as a new proposed version.`,
                    };

                    const nextVersion = existing!.latestVersion + 1;
                    return {
                        status: 'editing',
                        mode: 'edit',
                        name: normalizedName,
                        title: draft.title,
                        is_internal: draft.is_internal,
                        document_type: draft.document_type,
                        ...(existingDocumentType &&
                            existingDocumentType !== document_type && { previousDocumentType: existingDocumentType }),
                        loadedFrom,
                        loadedVersion,
                        nextVersion,
                        lines: countLines(draft.content),
                        message: messages[loadedFrom],
                        ...(isDeleted && { previouslyDeleted: true }),
                        ...(rejectionReason && { rejectionReason }),
                    };
                } catch (err: any) {
                    return { error: err.message };
                }
            },
        },

        // ----------------------------------------------------------------
        // write_document - Append to editing draft
        // ----------------------------------------------------------------
        {
            name: 'write_document' as const,
            description: `Append content to the current editing draft.

Requires an active draft started with begin_document.
Can be called multiple times to add content in chunks.
Content streams to the UI in real-time.`,
            parameters: WriteDocumentParams,
            executor: (input: z.infer<typeof WriteDocumentParams>, ctx: DocumentToolsContext) => {
                const { content } = input;
                const { draftManager } = ctx;

                try {
                    const draft = draftManager.append(content);
                    const addedLines = countLines(content);
                    const totalLines = countLines(draft.content);

                    return {
                        status: 'written',
                        charsAdded: content.length,
                        linesAdded: addedLines,
                        totalLines,
                    };
                } catch (err: any) {
                    return { error: err.message };
                }
            },
        },

        // ----------------------------------------------------------------
        // patch_document - Precision line-based editing
        // ----------------------------------------------------------------
        {
            name: 'patch_document' as const,
            description: `Make precise edits to the current draft. Batch multiple edits into one call when possible.

Each edit: startLine anchor + exact oldContent to find + newContent replacement.
${PATCH_DOCUMENT_ALLOW_EXPLICIT_END_LINE ? '`endLine` is optional; use it only to narrow the search window.' : 'Provide exactly `startLine`, `oldContent`, and `newContent`; the replacement span is inferred from `oldContent`.'}
IMPORTANT: \`read_document\` shows lines prefixed with \`N: \` (e.g. \`5: some text\`) — that prefix is display-only. Do NOT include it in \`oldContent\`; copy only the line text after \`N: \`.
Edits are atomic - all succeed or none apply. No need to read_document between patches.`,
            parameters: PatchDocumentParams,
            executor: (
                input: z.infer<typeof PatchDocumentParams>,
                ctx: DocumentToolsContext,
                _eCtx?: unknown,
                _history?: unknown,
                toolCallId?: string,
            ) => {
                const { edits } = input ?? {};
                const { draftManager } = ctx;

                if (!edits?.length) {
                    return { error: 'patch_document requires at least one edit in the edits array.' };
                }

                try {
                    const draft = draftManager.requireCurrent();

                    // Convert to EditOperation format
                    const editOps: EditOperation[] = edits.map((e) => ({
                        startLine: e.startLine,
                        endLine: PATCH_DOCUMENT_ALLOW_EXPLICIT_END_LINE
                            ? (e as { endLine?: number | null }).endLine
                            : undefined,
                        oldContent: e.oldContent,
                        newContent: e.newContent,
                    }));

                    // Apply edits atomically
                    const result = applyEdits(draft.content, editOps);

                    if (!result.success) {
                        return { error: result.error };
                    }

                    // Update draft with new content
                    draftManager.setContent(result.newContent!);

                    // Stash canonical edits for document-events (side channel — keeps full-range content out of the model-facing tool result).
                    if (toolCallId && result.appliedEdits) {
                        draftManager.setAppliedEdits(toolCallId, result.appliedEdits);
                    }

                    return {
                        status: 'edited',
                        editsApplied: edits.length,
                        linesNow: result.linesNow,
                    };
                } catch (err: any) {
                    return { error: err.message };
                }
            },
        },

        // ----------------------------------------------------------------
        // finalize_document - Save as proposed version
        // ----------------------------------------------------------------
        {
            name: 'finalize_document' as const,
            description: `Save the current editing draft as a proposed version.

You MUST call this after begin_document or the content will be lost.
The version is saved with status "proposed" - it will NOT be live until a user approves it.
If a proposed version already exists, it will be marked as "superseded".`,
            parameters: FinalizeDocumentParams,
            executor: async (_input: z.infer<typeof FinalizeDocumentParams>, ctx: DocumentToolsContext, rCtx?: Ctx) => {
                const { em, chatId, draftManager, embeddingQueue, createdVersionIds } = ctx;
                const scope = getScope(ctx);

                try {
                    const draft = draftManager.requireCurrent();

                    // Persist to database as proposed
                    const result = await upsertDocument(
                        em,
                        scope,
                        chatId,
                        draft.name,
                        draft.title,
                        draft.content,
                        draft.is_internal,
                        draft.document_type,
                    );

                    // Track version for linking to assistant message later
                    createdVersionIds.push(result.versionId);

                    // Notify listener (user-scoped broadcast)
                    ctx.onVersionCreated?.({
                        artifactName: draft.name,
                        versionId: result.versionId,
                        version: result.version,
                        action: result.action,
                        documentType: draft.document_type,
                    });

                    draftManager.discard();

                    // ── PECP path ────────────────────────────────────────────
                    // Auto-approve, link parent, mark artifact, no embedding,
                    // no AI content, no chat directive.
                    if (draft.document_type === 'PECP') {
                        if (draft.parentVersionId) {
                            const pecpVersion = await em.findOneOrFail(
                                ArtifactVersionEntity,
                                { id: result.versionId },
                                { populate: ['artifact'] },
                            );
                            pecpVersion.status = 'approved';
                            pecpVersion.status_changed_at = new Date();
                            pecpVersion.parent_version = em.getReference(ArtifactVersionEntity, draft.parentVersionId);
                            pecpVersion.artifact.is_pecp = true;
                            pecpVersion.artifact.current_version = pecpVersion;
                            await em.flush();
                        }

                        ctx.pendingPECP = null;

                        return {
                            result: {
                                action: result.action,
                                name: draft.name,
                                version: result.version,
                                status: 'approved',
                                lines: result.lines,
                                isPECP: true,
                            },
                            appendedOutput: '',
                            message: `PECP saved and auto-approved as v${result.version}.`,
                        };
                    }

                    // ── Completion Brief tracking ────────────────────────────
                    if (draft.document_type === 'Completion Brief') {
                        const chatEntity = await em.findOne(ChatEntity, { id: chatId });
                        if (chatEntity) {
                            chatEntity.completion_brief = em.getReference('ArtifactEntity', result.artifactId) as any;
                            chatEntity.completion_brief_status = 'proposed';
                            await em.flush();
                        }
                    }

                    // ── Regular document path ────────────────────────────────
                    // Embedding + AI content classification (fire-and-forget, non-blocking)
                    if (embeddingQueue && (ctx.projectId || ctx.chatId)) {
                        const classifyAndEmbed = async () => {
                            const generateAiContent = rCtx
                                ? await shouldGenerateAiContent(rCtx, draft.name, draft.title)
                                : true;

                            await embeddingQueue.send({
                                type: 'index_artifact_version',
                                projectId: ctx.projectId ?? null,
                                chatId: ctx.chatId ?? null,
                                versionId: result.versionId,
                                content: draft.content,
                                documentName: draft.name,
                                is_ai_content: generateAiContent,
                                previewAlias: ctx.previewAlias,
                            });
                        };

                        const embedPromise = classifyAndEmbed().catch((err) =>
                            console.error('[finalize_document] Classify/embed error:', err),
                        );

                        rCtx?.eCtx?.waitUntil(embedPromise);
                    }

                    const toolResult: Record<string, unknown> = {
                        action: result.action,
                        name: draft.name,
                        version: result.version,
                        status: 'proposed',
                        lines: result.lines,
                    };

                    const response: Record<string, unknown> = {
                        result: toolResult,
                        appendedOutput: `::document[${draft.name}]{version=${result.version} lines=${result.lines} documentType="${draft.document_type}"}`,
                        message: `Saved as proposed v${result.version}. Awaiting user approval to become live. STOP HERE — do not create any more documents until the user asks.`,
                    };

                    if (result.supersededVersion) {
                        toolResult.supersededVersion = result.supersededVersion;
                        response.supersededVersion = result.supersededVersion;
                        response.message = `Saved as proposed v${result.version}. Previous proposed v${result.supersededVersion} was superseded. STOP HERE — do not create any more documents until the user asks.`;
                    }

                    // Internal documents → instruct agent to generate PECP
                    if (shouldGeneratePECP(draft.document_type)) {
                        const pecpKey = pecpKeyForDocument(draft.name);
                        const pecpInfo = {
                            parentDocument: draft.name,
                            parentDocumentType: draft.document_type,
                            pecpKey,
                        };
                        toolResult.pecpRequired = pecpInfo;
                        response.pecpRequired = pecpInfo;
                        // Store on context so onTurnComplete can nudge the agent
                        ctx.pendingPECP = pecpInfo;
                        response.message = `Saved as proposed v${result.version}. Awaiting user approval. Now you MUST generate a PECP for this "${draft.document_type}". Call begin_document with mode="create", name="${pecpKey}", document_type="PECP", parent_document="${draft.name}". Write the PE-facing communication using the appropriate PECP stage template from your system prompt, then finalize.`;
                    }

                    return response;
                } catch (err: any) {
                    return { error: err.message };
                }
            },
        },

        // ----------------------------------------------------------------
        // read_document - View document
        // ----------------------------------------------------------------
        {
            name: 'read_document' as const,
            description: `View document content with optional line range.

If you have an active editing draft for this document, returns the draft content.
Otherwise returns the requested version from the database.

Skip this call if you authored or patched the document earlier in the same conversation — your own content is authoritative and re-reading wastes tokens.

Version options:
- "approved": The live version (what users see)
- "proposed": The pending version awaiting approval
- "latest": The most recent version regardless of status (default)

Embedded images are included by default. Pass skipImages: true for text-only output.`,
            parameters: ReadDocumentParams,
            executor: async (input: z.infer<typeof ReadDocumentParams>, ctx: DocumentToolsContext, rCtx?: Ctx) => {
                const { name, version: versionMode, startLine, endLine, skipImages } = input;
                const { em, draftManager } = ctx;
                const scope = getScope(ctx);

                const normalizedName = normalizeArtifactKey(name);

                // Check for active editing draft first — no image resolution for drafts
                const draft = draftManager.getCurrent();
                if (draft && draft.name === normalizedName) {
                    const viewport = extractViewport(draft.content, startLine ?? undefined, endLine ?? undefined);
                    return {
                        source: 'editing_draft',
                        name: normalizedName,
                        totalLines: viewport.totalLines,
                        viewport: { startLine: viewport.startLine, endLine: viewport.endLine },
                        content: viewport.content,
                        message: 'Reading from your current editing session (not yet saved).',
                    };
                }

                // Fetch from database
                const doc = await findDocumentByName(em, scope, normalizedName);
                if (!doc) {
                    return {
                        error: `Document "${normalizedName}" not found. Use begin_document to create it.`,
                    };
                }

                // Determine which content to return based on version mode
                let content: string | null = null;
                let source: string;
                let version: number | null = null;

                switch (versionMode) {
                    case 'approved':
                        content = doc.approvedContent;
                        version = doc.approvedVersion;
                        source = 'approved';
                        if (!content) {
                            return {
                                error: `No approved version exists for "${normalizedName}". Document may be pending first approval.`,
                                hasProposed: doc.proposedVersion !== null,
                                proposedVersion: doc.proposedVersion,
                            };
                        }
                        break;

                    case 'proposed':
                        content = doc.proposedContent;
                        version = doc.proposedVersion;
                        source = 'proposed';
                        if (!content) {
                            return {
                                error: `No proposed version exists for "${normalizedName}".`,
                                hasApproved: doc.approvedVersion !== null,
                                approvedVersion: doc.approvedVersion,
                            };
                        }
                        break;

                    case 'latest':
                    default:
                        // Prefer proposed > approved > rejected
                        if (doc.proposedContent !== null) {
                            content = doc.proposedContent;
                            version = doc.proposedVersion;
                            source = 'proposed';
                        } else if (doc.approvedContent !== null) {
                            content = doc.approvedContent;
                            version = doc.approvedVersion;
                            source = 'approved';
                        } else if (doc.rejectedContent !== null) {
                            content = doc.rejectedContent;
                            version = doc.rejectedVersion;
                            source = 'rejected';
                        } else {
                            return { error: `No content available for "${normalizedName}".` };
                        }
                        break;
                }

                const viewport = extractViewport(content, startLine ?? undefined, endLine ?? undefined);
                // TODO: Return a structured line payload alongside/instead of numbered text so patch callers
                // do not need to strip display-only "N: " prefixes before using oldContent.

                // Resolve documentType from the version source
                const documentType =
                    source === 'proposed'
                        ? doc.proposedDocumentType
                        : source === 'rejected'
                          ? doc.rejectedDocumentType
                          : (doc.currentDocumentType ?? 'Other');

                const response: Record<string, unknown> = {
                    source,
                    name: normalizedName,
                    version,
                    status: source,
                    documentType,
                    totalLines: viewport.totalLines,
                    viewport: { startLine: viewport.startLine, endLine: viewport.endLine },
                    content: viewport.content,
                };

                // Add hints about other versions
                if (source === 'approved' && doc.proposedVersion !== null) {
                    response.hasProposed = true;
                    response.proposedVersion = doc.proposedVersion;
                }
                if (source === 'proposed' && doc.approvedVersion !== null) {
                    response.hasApproved = true;
                    response.approvedVersion = doc.approvedVersion;
                }

                // Resolve artifact images — sign refs and return multimodal content.
                // Refs stay in toolOutput text (stable for DB, needed by Chat Completions replacement).
                if (!skipImages && rCtx) {
                    const hydrated = await hydrateArtifactImages(viewport.content, rCtx.env, {
                        projectId: ctx.projectId,
                        chatId: ctx.chatId,
                    });
                    if (hydrated) {
                        return {
                            result: response,
                            imageRefs: hydrated.imageRefs,
                            contentParts: hydrated.contentParts,
                        };
                    }
                }

                return response;
            },
        },

        // ----------------------------------------------------------------
        // list_documents - Browse with status info
        // ----------------------------------------------------------------
        {
            name: 'list_documents' as const,
            description: `List all documents in the project with version status information.

Shows for each document:
- currentVersion: The approved (live) version number, or null if none approved yet
- latestVersion: The most recent version number (any status)
- latestStatus: Status of the latest version (proposed/approved/rejected/superseded)
- hasProposed: Whether there's a proposed version awaiting approval

IMPORTANT: Document cards are automatically rendered in the UI from this tool's output. Do NOT repeat, list, or summarize individual documents in your text response (no tables, no bullet lists of documents). Just provide a brief commentary or answer the user's question.

Use \`silent: true\` when you need to check documents internally (e.g. before editing, verifying status) without showing cards to the user.`,
            parameters: ListDocumentsParams,
            executor: async (input: z.infer<typeof ListDocumentsParams>, ctx: DocumentToolsContext) => {
                const { search, silent } = input;
                const { em } = ctx;
                const scope = getScope(ctx);

                const documents = await listDocumentsDb(em, scope, search ? { search } : undefined);

                const mapped = documents.map((d: DocumentListItem) => ({
                    name: d.name,
                    title: d.title,
                    lines: d.lines,
                    documentType: d.documentType,
                    currentVersion: d.currentVersion,
                    latestVersion: d.latestVersion,
                    latestStatus: d.latestStatus,
                    hasProposed: d.hasProposed,
                    ...(d.isReadOnly && { isReadOnly: true }),
                }));

                if (silent) {
                    return { documents: mapped };
                }

                const directives = documents
                    .map(
                        (d: DocumentListItem) =>
                            `::document[${d.name}]{version=${d.latestVersion} lines=${d.lines} documentType="${d.documentType}" ref}`,
                    )
                    .join('\n');

                return {
                    result: { documents: mapped },
                    appendedOutput: directives,
                };
            },
        },

        // ----------------------------------------------------------------
        // approve_document - Approve a proposed document version
        // ----------------------------------------------------------------
        {
            name: 'approve_document' as const,
            description: `Approve a proposed document version, making it the live (approved) version.

**USER-INITIATED ONLY** — NEVER call this automatically after creating or finalizing a document. Only call when the user signals approval (e.g., "approved", "looks good", "LGTM", "proceed", "accept").
If the user's message combines approval with another request (e.g., "approved, now do X"), call this tool FIRST, then handle the rest.

**STATUS CONSTRAINT:** ONLY works on documents whose current version has status "proposed". Documents that are "rejected", "approved", or "superseded" CANNOT be approved with this tool. If a document was rejected, you must revise it first (begin_document → edit → finalize_document) to create a new "proposed" version before it can be approved.

**ERROR HANDLING:** If this tool returns an error, you MUST NOT claim the document was approved. NEVER forward raw error details to the user — instead, communicate naturally (e.g., "This document needs to be revised before it can be approved. Let me update it for you.") and take the appropriate recovery action (revise the document).

This triggers AI content generation (YAML) for internal documents and queues embedding indexing.`,
            parameters: ApproveDocumentParams,
            executor: async (input: z.infer<typeof ApproveDocumentParams>, ctx: DocumentToolsContext, eCtx?: Ctx) => {
                const { name } = input;
                const { em } = ctx;
                const scope = getScope(ctx);

                if (!eCtx) {
                    return { error: 'Execution context not available' };
                }

                const normalizedName = normalizeArtifactKey(name);
                const doc = await findDocumentByName(em, scope, normalizedName);

                if (!doc) {
                    return { error: `Document "${normalizedName}" not found.` };
                }

                if (doc.proposedVersion === null) {
                    return {
                        error: `Document "${normalizedName}" has no proposed version to approve. Only documents with a "proposed" version can be approved. If the document was rejected, it must be revised first (begin_document → edit → finalize_document) to create a new proposed version.`,
                    };
                }

                // Find the proposed version entity to get its UUID
                const proposedVersion = await findVersionByStatus(em, doc.id, 'proposed');
                if (!proposedVersion) {
                    return {
                        error: `No version with status "proposed" found for "${normalizedName}". The document must be revised (begin_document → edit → finalize_document) to create a new proposed version before it can be approved.`,
                    };
                }

                try {
                    const result = await approveArtifactHandler({ versionId: proposedVersion.id }, eCtx);
                    return {
                        ...result,
                        name: normalizedName,
                        message: `Document "${normalizedName}" v${result.version} has been approved and is now live. STOP HERE — do not create any more documents unless the user explicitly asks.`,
                    };
                } catch (err: any) {
                    return { error: err.message || 'Failed to approve document' };
                }
            },
        },

        // ----------------------------------------------------------------
        // reject_document - Reject a proposed document version
        // ----------------------------------------------------------------
        {
            name: 'reject_document' as const,
            description: `Reject a proposed document version with feedback.

**USER-INITIATED ONLY** — NEVER call this automatically. Only call when the user signals rejection (e.g., "reject", "redo this", "needs changes", or provides specific revision feedback for a pending document).
If the user's message combines rejection with other instructions, call this tool FIRST, then handle the rest.

Only works on documents that have a proposed version awaiting approval.
The rejection reason is stored and will be shown when the document is next edited.`,
            parameters: RejectDocumentParams,
            executor: async (input: z.infer<typeof RejectDocumentParams>, ctx: DocumentToolsContext, eCtx?: Ctx) => {
                const { name, reason } = input;
                const { em } = ctx;
                const scope = getScope(ctx);

                if (!eCtx) {
                    return { error: 'Execution context not available' };
                }

                const normalizedName = normalizeArtifactKey(name);
                const doc = await findDocumentByName(em, scope, normalizedName);

                if (!doc) {
                    return { error: `Document "${normalizedName}" not found.` };
                }

                if (doc.proposedVersion === null) {
                    return { error: `Document "${normalizedName}" has no proposed version to reject.` };
                }

                // Find the proposed version entity to get its UUID
                const proposedVersion = await findVersionByStatus(em, doc.id, 'proposed');
                if (!proposedVersion) {
                    return { error: `Proposed version for "${normalizedName}" not found.` };
                }

                try {
                    const result = await rejectArtifactHandler({ versionId: proposedVersion.id, reason }, eCtx);
                    return {
                        ...result,
                        name: normalizedName,
                        message: `Document "${normalizedName}" v${result.version} has been rejected. Reason: ${reason}`,
                    };
                } catch (err: any) {
                    return { error: err.message || 'Failed to reject document' };
                }
            },
        },
    ] as const;
}
