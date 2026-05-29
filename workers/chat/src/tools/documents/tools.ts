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

import { COLLAPSED_FIELD_SENTINEL } from '@common/ai/agent/collapse';
import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import type { ToolCallStreamBlock } from '@common/ai/agent/types';
import type { QueueAdapter } from '@common/common/queue.adapter';
import type { EntityManager } from '@mikro-orm/core';
import { z } from 'zod';
import { hydrateArtifactImages } from '@/lib/artifacts/artifact-images';
import { normalizeArtifactKey } from '@/lib/artifacts/utils';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { DocumentTypeSchema, INTERNAL_DOCUMENTS } from '@/lib/schema/artifact';
import type { StreamEvent } from '@/lib/schema/stream';
import type { ILockService } from '@/workers/_common/util/locks';
import { approveArtifactHandler, rejectArtifactHandler } from '../../artifact-approver';
import type { Ctx } from '../../context';
import {
    applyEdits,
    buildPatchTouchedRegions,
    cleanupOrphanArtifact,
    countLines,
    type DocumentListItem,
    type DocumentScope,
    draftFitsBeginContentCap,
    type EditOperation,
    extractViewport,
    findDocumentByName,
    findVersionByStatus,
    formatFullDraftContent,
    listDocuments as listDocumentsDb,
    reserveDraftVersion,
    upsertDocument,
} from './document-service';
import { DraftManager } from './draft-manager';
import { generateInternalSummary } from './pecp-generator';
import { shouldGenerateInternalSummary } from './pecp-service';

// ============================================================================
// TYPES
// ============================================================================

export interface DocumentToolsContext {
    /** Entity manager for DB operations */
    em: EntityManager;
    /** Worker-safe lock service used to serialize artifact key/version reservation. */
    lockService: ILockService;
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
    /**
     * Push stream events to the active SSE / DO stream (frontend listens via useStream).
     * Set by chat-handler / phase transition when wiring tool execution into a streaming session.
     * The Internal Summary generator pushes `summary_start` / `summary_delta` / `summary_complete` here.
     */
    pushStreamEvents?: (events: StreamEvent[]) => void;
    /** Optional callback fired when a new artifact version is created (for user-scoped broadcasts) */
    onVersionCreated?: (event: {
        artifactName: string;
        versionId: string;
        version: number;
        action: 'created' | 'proposed';
        status?: 'proposed' | 'superseded';
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
1. \`begin_document\` - Start a draft. \`edit\` loads existing content; \`create\` and \`replace\` start empty.
2. \`write_document\` / \`patch_document\` - Make changes
3. \`finalize_document\` - Save (MUST call or content is lost)

## Editing Strategy
- For existing-document edits, start with \`begin_document\`; \`patch_document\` and \`write_document\` require an active draft. For patch edits, use \`begin_document(mode="edit")\` → \`patch_document\` → \`finalize_document\`. If \`begin_document\` returns \`content\`, use it directly and do not call \`read_document\`. Call \`read_document\` only after \`begin_document\` when begin omitted \`content\` or you need a viewport not in \`content\` / prior \`touched\`.
- For appending content to an existing document, use this sequence: \`begin_document(mode="edit")\` → \`write_document\` with the new content → \`finalize_document\`.
- For existing-document full rewrites (≥50% of content changing), use this sequence: \`begin_document(mode="replace")\` → \`write_document\` with the full replacement content → \`finalize_document\`.
- If you authored or patched this document earlier in the same conversation, skip \`read_document\` and patch directly — your own content is authoritative.
- After \`begin_document(mode="create")\`, call \`write_document\` to add the new draft content you want to save.
- \`patch_document\` edits are atomic and verified. Do not re-read only to confirm a successful patch.
- For \`patch_document\`, multiline \`oldContent\` and \`newContent\` are allowed. Ensure tool arguments remain valid JSON strings; do not place raw unescaped newlines inside JSON string literals.
- \`begin_document\` \`content\`, \`patch_document\` \`touched\`, and \`read_document\` prefix lines with \`N: \` (e.g. \`5: some text\`) for orientation. This prefix is DISPLAY ONLY — do NOT include it in \`oldContent\`. Copy only the line text after \`N: \`.
${PATCH_DOCUMENT_ALLOW_EXPLICIT_END_LINE ? '- For `patch_document` edits, provide `startLine`, `oldContent`, and `newContent`; `endLine` is optional and only narrows the search window.' : '- For `patch_document` edits, provide exactly `startLine`, `oldContent`, and `newContent`. The replacement span is inferred from `oldContent`.'}
- Within one \`patch_document\` call, all edit line numbers are interpreted in the active draft's pre-edit frame. Prefer anchors from \`begin_document\` \`content\` or prior \`patch_document\` \`touched\`; use \`read_document\` only as a fallback viewport after \`begin_document\`. Batch all edits for that one snapshot into a single \`patch_document\` call when possible.
- Between separate \`patch_document\` calls, use the post-edit line numbers from the prior call's \`touched\` output for the next anchors. Do not \`read_document\` between successive patches just to re-anchor. If \`touched\` is omitted, truncated, or does not include the region you need, call \`read_document\` for the needed viewport.
- ANTI-PATTERN: read → patch → read → patch loops on large documents are wasteful and often cause stream failures. Batch all edits for one snapshot into a single \`patch_document\` call instead.
- For long-document simplification or structural rewrites, use patches that cover whole stable contiguous sections rather than many tiny edits.
- If you decide to abandon the active draft without saving, call \`finalize_document({ action: "abort" })\`.

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
- Do NOT call ANY document tools (begin_document, write_document, finalize_document, etc.) in response to a system event unless the user explicitly asks you to.
- For approvals: briefly confirm the approval. Do NOT start generating the next document, phase, or any content. Simply ask the user what they'd like to do next.
- For rejections: read the reason and ask the user if they'd like you to revise. Do NOT start revising automatically.
- For restores: the user has reverted to an earlier version via the version history panel. The selected content has been saved as a new PROPOSED version — it is NOT yet live and is awaiting the user's decision. The system event message itself contains the inline instructions and the exact \`::document[…]\` directive to include in your reply — follow them verbatim, briefly acknowledge, and ask what the user would like to do. Do NOT preemptively call \`approve_document\` or \`reject_document\` on your own initiative — a restored proposed version is approved/rejected the same way as any other proposed version: the user may click approve/reject in the UI, or signal it in their next chat message (in which case follow the normal chat-based approval rules below and call \`approve_document\`/\`reject_document\`), or ask you to revise it further (in which case follow the normal begin_document → edit → finalize_document flow).

### Detecting approval/rejection intent (chat messages only)
When a **regular** user message (not a \`<system>\` event) contains approval or rejection signals, you MUST process them BEFORE acting on any other part of the message.
- **Approval signals:** "approved", "looks good", "accept", "approve it", "LGTM", "ship it", "all good", "proceed" (when a proposed document is pending), or similar positive confirmation.
- **Rejection signals:** "reject", "redo", "not good", "change X", "needs work", or explicit revision requests for a pending proposed document.
- **Compound messages:** If the user says something like "approved, now do X" or "looks good, proceed with Y" — FIRST call \`approve_document\` for the pending document, THEN do exactly that one explicit follow-up (X / Y) and stop. Do NOT chain into "what's next".
- **Ambiguity:** If it's unclear whether the user is approving or just continuing, and there IS a pending proposed document, ask for clarification before proceeding.

## Conflict Resolution — ALWAYS Ask the User
When a tool call fails or returns an error with multiple concrete recovery paths (e.g., name already taken, document not found, mode mismatch), **do NOT silently recover or decide on your own**. Instead, call \`request_user_decision\` with a clear question and the available options. For example:
- Name conflict: question "A document called X already exists. What should I do?" with options \`edit_existing\` ("Edit the existing document") and \`create_new\` ("Create with a different name").
- Document not found: question "I couldn't find a document called X." with options \`create\` ("Create it now") and \`pick_existing\` ("Show me what exists and let me pick").

Let the user's click drive the next step. **Never assume the user's intent when multiple valid paths exist.**

## Important
\`list_documents\` and \`read_document\` are for viewing specific documents. Use \`search_knowledge\` to find relevant context via semantic search across all approved documents.

## Finding Documents / Files
When the user asks about a specific file or document (e.g., "what's in the UX doc?", "check the analysis file"):
1. **First** use \`search_knowledge\` with a relevant query — this searches by semantic similarity across all approved documents.
2. If \`search_knowledge\` returns no relevant results, use \`list_documents\` to browse available documents and find the right name.
3. Then use \`read_document\` with the exact document name to view its full content.
Never skip straight to \`read_document\` with a guessed name — always discover the correct name first via search or listing.

## PE Communication Summaries (Auto-Generated)
When you finalize an internal working document (Genesis DNA, Legacy DNA, Team Specification, MID, PSEB, Action Plan, Completion Brief, Company Profile, Human Persona), the backend automatically generates the PE-facing summary for it. You do NOT call any tools to produce it — it is written to the parent version's \`summary_internal\` field by a separate summary agent during finalize_document. After finalize_document returns, STOP and wait for the user.

**CRITICAL: Do NOT write any PECP-style content in your chat reply.** After finalizing an internal document, your text response must be a single brief confirmation — no structure, no headers, no bullet points. Do NOT:
- Recap the document contents in your message
- Write client-facing narrative, executive summaries, or "what we built / why this matters" style text
- Echo or paraphrase the document in any form
The PECP summary is written automatically by a separate agent and displayed in the UI — your chat response is only a confirmation that the document was saved.

## Proactive Actions (FORBIDDEN)
**NEVER create documents the user did not explicitly request.** After an approval, rejection, or restore, STOP and wait for the user's next message — UNLESS the same chat message also contained an explicit follow-up request (compound case above), in which case do exactly that one follow-up and then stop. \`<system>\` approval/rejection/restore events are NEVER compound — always stop. Do NOT:
- Automatically start creating "the next logical document"
- Generate follow-up content without being asked
- Chain approvals into new document creation
- Anticipate what the user "probably wants next"
- Call any document tools (begin_document, write_document, finalize_document, etc.) unless the user explicitly asks
- Mention "Phase 2", "next step", or suggest what comes next — let the user drive the workflow
Only create, edit, or finalize documents when the user explicitly asks for them in their message.`,
    behavioralGuidance: `Always call begin_document(mode="edit") before the first patch_document for existing-document edits; patch_document applies only to the active draft. If begin_document returns content, use it directly and do not call read_document. read_document is only a fallback after begin_document when begin omitted content or you need a viewport not in begin content or prior touched. Do not re-read only to confirm a successful patch. If you authored or patched this document earlier in the same conversation, skip read_document and patch directly — your own content is authoritative. For rewriting most of an existing document, call begin_document(mode="replace") and then write_document with the new draft content you want to save. In replace mode, returned content is the prior version for reference only; the active draft starts empty. After begin_document(mode="create") or begin_document(mode="replace"), call write_document with the new draft content you want to save. ${PATCH_DOCUMENT_ALLOW_EXPLICIT_END_LINE ? 'Patch edits may include optional endLine only to narrow the search window.' : 'Patch edits have exactly three fields: startLine, oldContent, and newContent.'} When copying text from begin_document content, patch_document touched, or read_document into oldContent, strip the leading "N: " line-number prefix — it is display-only and must not appear in oldContent. Within one patch_document call, all edit line numbers are interpreted in the active draft's pre-edit frame. Prefer anchors from begin_document content or prior patch_document touched; use read_document only as a fallback viewport after begin_document. Batch all known edits for that snapshot into a single patch_document call when possible. Between separate patch_document calls, use post-edit line numbers from the prior call's touched output for the next anchors; do not read_document between successive patches just to re-anchor. If touched is omitted, truncated, or does not include the region you need, call read_document for the needed viewport. ANTI-PATTERN: read → patch → read → patch loops on large documents are wasteful and often cause stream failures — batch all edits for one snapshot into a single patch_document call. For long-document simplification or structural rewrites, use patches that cover whole stable contiguous sections rather than many tiny edits. Do NOT include meta-labels like "AI Readable Specification" or "Machine Readable Format" in documents — write clean, professional content. When a REGULAR user message (not a <system> event) contains approval/rejection signals AND a proposed document is pending, ALWAYS call approve_document or reject_document FIRST before handling other requests in the same message. CRITICAL: When you receive a <system> event indicating an artifact was approved or rejected, the action is ALREADY DONE — do NOT call approve_document or reject_document again, do NOT call any document tools, and do NOT start generating next documents or phases. Just briefly acknowledge and wait for the user to tell you what to do next. CRITICAL: When you receive a <system> event indicating an artifact was RESTORED, the selected content has been saved as a new PROPOSED version awaiting the user's decision — it is NOT live and the action is NOT complete. The system event itself contains the exact ::document[…] directive and instructions inline — follow them verbatim, briefly acknowledge, and ask what the user wants to do. Do NOT manufacture ::document[…] directives on your own outside of this restore flow — they belong in finalize_document/list_documents tool output and in restore system events only. Do NOT preemptively call approve_document or reject_document — the restored proposed version follows the normal approval flow (UI button or explicit user signal in next chat message). CRITICAL: approve_document ONLY works on "proposed" documents. If a document is rejected/approved/superseded, do NOT attempt to approve it — revise it first (begin_document → edit → finalize_document) to create a new proposed version, then approve. If approve_document or reject_document returns an error, NEVER claim success and NEVER expose raw error details or internal statuses to the user — communicate naturally and take the recovery action. CRITICAL: NEVER proactively create, write, or finalize documents that the user did not explicitly request. The PE-facing summary for an internal document is generated automatically by the backend during finalize_document — you do not need to (and must not) create a separate "PECP" document yourself. CRITICAL: After finalize_document for an internal document, your chat reply must be a single brief confirmation — no structure, no headers, no bullet points. Do NOT write PECP-style summaries, client-facing narratives, document recaps, or "what we built / why this matters" content in your chat message — the PECP is generated by a separate agent and displayed in the UI. After approving, rejecting, or restoring a document, STOP and wait for the user's next instruction — UNLESS the same message had an explicit follow-up request (e.g. "approved, now do X"), in which case do exactly X and then stop. Never chain into "what's next" or generate proactive follow-up content. \`<system>\` approval/rejection/restore events are never compound — always stop. CRITICAL: When a document tool returns an error with multiple concrete recovery paths (name conflict, not found, mode mismatch, etc.), NEVER silently recover or decide on your own. Call request_user_decision with a clear question and the concrete named options, then act on the user's choice.`,
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
        .enum(['create', 'edit', 'replace'])
        .describe(
            'Operation mode: "create" (new document, fails if exists), "edit" (modify existing content in place), "replace" (rewrite existing document from scratch)',
        ),
    name: z.string().min(1).describe('Document name (e.g., "analysis.md"). Extension auto-appended if missing.'),
    title: z.string().optional().nullable().describe('Display title for the document (required for create).'),
    document_type: DocumentTypeSchema.describe(
        'Classification of the document type. Must be one of the allowed types. The type determines whether the document is internal (hidden from the user) or a client deliverable (visible) — no separate flag is needed. In edit mode, you should generally keep the same value as the existing version.',
    ),
});

const WriteDocumentParams = z.object({
    content: z.string().describe('Content to write to the current editing draft.'),
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

const FinalizeDocumentParams = z.object({
    action: z
        .enum(['save', 'abort'])
        .optional()
        .default('save')
        .describe(
            'Finalize behavior: "save" persists the draft as a proposed version; "abort" discards the active draft without saving.',
        ),
});

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

function parseToolOutputObject(block: ToolCallStreamBlock): Record<string, unknown> | null {
    if (typeof block.toolOutput !== 'string') return null;
    try {
        const parsed = JSON.parse(block.toolOutput);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

function textStats(value: unknown): { chars: number; lines: number } {
    if (typeof value !== 'string') return { chars: 0, lines: 0 };
    return { chars: value.length, lines: countLines(value) };
}

function collapseWriteDocument(block: ToolCallStreamBlock): { toolInput?: unknown; toolOutput?: string } {
    const input = block.toolInput as { content?: string } | undefined;
    const collapsedInput = { __collapsedContent: COLLAPSED_FIELD_SENTINEL, originalChars: input?.content?.length ?? 0 };

    if (!block.toolSuccess) {
        return { toolInput: collapsedInput };
    }

    const output = parseToolOutputObject(block);
    if (output) {
        output.recallHint = 'Use recall_tool_call to retrieve the original content.';
        return { toolInput: collapsedInput, toolOutput: JSON.stringify(output) };
    }
    return { toolInput: collapsedInput };
}

function collapsePatchDocument(block: ToolCallStreamBlock): { toolInput?: unknown; toolOutput?: string | undefined } {
    const input = block.toolInput as { edits?: unknown } | undefined;
    const edits = Array.isArray(input?.edits) ? input.edits : [];

    const collapsedInput = {
        editsCount: edits.length,
        edits: edits.map((rawEdit) => {
            const edit = rawEdit && typeof rawEdit === 'object' ? (rawEdit as Record<string, unknown>) : {};
            const oldStats = textStats(edit.oldContent);
            const newStats = textStats(edit.newContent);
            return {
                startLine: edit.startLine,
                ...(edit.endLine != null && { endLine: edit.endLine }),
                oldContentLines: oldStats.lines,
                oldContentChars: oldStats.chars,
                newContentLines: newStats.lines,
                newContentChars: newStats.chars,
            };
        }),
    };

    if (!block.toolSuccess) {
        return { toolInput: collapsedInput };
    }

    const output = parseToolOutputObject(block);
    if (output) {
        output.recallHint = 'Use recall_tool_call to retrieve the original edits or touched-region content.';
        delete output.touched;
        return { toolInput: collapsedInput, toolOutput: JSON.stringify(output) };
    }
    return { toolInput: collapsedInput };
}

function collapseBeginDocument(block: ToolCallStreamBlock): { toolOutput?: string } {
    const output = parseToolOutputObject(block);
    if (!output || !('content' in output)) return {};

    const contentStats = textStats(output.content);
    const collapsed = { ...output };
    delete collapsed.content;
    collapsed.contentCollapsed = true;
    collapsed.contentLines = contentStats.lines;
    collapsed.contentChars = contentStats.chars;
    collapsed.recallHint = 'Use recall_tool_call to retrieve the loaded draft content.';

    return { toolOutput: JSON.stringify(collapsed) };
}

function collapseReadDocument(block: ToolCallStreamBlock): { toolOutput?: string } {
    const output = parseToolOutputObject(block);
    if (!output || !('content' in output)) return {};

    const contentStats = textStats(output.content);
    const collapsed = { ...output };
    delete collapsed.content;
    collapsed.contentCollapsed = true;
    collapsed.contentLines = contentStats.lines;
    collapsed.contentChars = contentStats.chars;
    collapsed.recallHint = 'Use recall_tool_call with this tool_call_id to retrieve the full document content.';

    return { toolOutput: JSON.stringify(collapsed) };
}

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
- "replace": Replace existing document from scratch - starts an empty draft for the next proposed version

Document Type (also controls visibility):
- Classify the document with the appropriate document_type.
- Internal working documents (Genesis DNA, Legacy DNA, Team Specification, MID, PSEB, Action Plan, Completion Brief, Company Profile, Human Persona) are hidden from the user.
- All other types (Research Report, Executive Summary, Other) are client-visible deliverables.
- In edit mode, you should generally keep the same document_type as the existing version.

After calling this:
- use write_document to add content in create or replace mode
- use patch_document for precise edits in edit mode
- use mode="replace" instead of edit+patch when rewriting most of an existing document from scratch
When editing an existing small/medium document, the loaded draft content is returned in the result when it contains the lines you need — no separate read_document call is needed in that case.
In replace mode, returned content is the prior version for reference only; the active draft starts empty and must be rewritten with write_document.
You MUST call finalize_document when done or content will be lost.`,
            parameters: BeginDocumentParams,
            collapseResult: collapseBeginDocument,
            executor: async (input: z.infer<typeof BeginDocumentParams>, ctx: DocumentToolsContext) => {
                const { mode, name, title, document_type } = input;
                const { em, draftManager, lockService } = ctx;
                const scope = getScope(ctx);
                const scopeId = ctx.projectId ?? ctx.userId!;

                // Internal/deliverable visibility is derived solely from document_type.
                const is_internal = (INTERNAL_DOCUMENTS as readonly string[]).includes(document_type);

                const normalizedName = normalizeArtifactKey(name);

                // Reserve the version slot under a per-key worker lock. Parallel
                // begin_document calls on the same artifactKey serialize here and end up
                // with distinct reservedVersion numbers — without this, two phases racing
                // on the same name both stream into (scope, key, version=1) and fight
                // for that entry in the frontend artifact store.
                const reservation = await reserveDraftVersion({ em, lockService, scope, name: normalizedName, mode });

                if (reservation.kind === 'read-only') {
                    return {
                        error: `Document "${normalizedName}" is a read-only public resource and cannot be edited. You can only read it using read_document.`,
                    };
                }

                if (reservation.kind === 'collision') {
                    return {
                        error: `Document "${normalizedName}" already exists. Call request_user_decision with options edit_existing ("Edit the existing document") and create_new ("Create with a different name"). Do NOT decide on your own.`,
                    };
                }

                if (reservation.kind === 'not-found') {
                    return {
                        error: `Document "${normalizedName}" does not exist. Call request_user_decision with options create ("Create a new document with this name") and pick_existing ("Show existing documents and let me pick"). Do NOT decide on your own.`,
                    };
                }

                const { artifactId, existing, reservedVersion, wasDeleted } = reservation;

                // Handle CREATE mode — fresh artifact, or restoring a previously-deleted one.
                if (mode === 'create') {
                    const docTitle = title || normalizedName;
                    try {
                        const draft = draftManager.begin({
                            artifactId,
                            scopeId,
                            name: normalizedName,
                            title: docTitle,
                            mode: 'create',
                            reservedVersion,
                            is_internal,
                            document_type,
                        });
                        return {
                            result: {
                                status: 'editing',
                                artifactId: draft.artifactId,
                                mode: 'create',
                                name: normalizedName,
                                title: draft.title,
                                is_internal: draft.is_internal,
                                document_type: draft.document_type,
                                nextVersion: reservedVersion,
                                lines: 0,
                                ...(wasDeleted && { previouslyDeleted: true }),
                                message: wasDeleted
                                    ? `Document "${normalizedName}" was previously deleted. Creating fresh content. Finalize to save.`
                                    : 'Draft started. Use write_document to add content, then finalize_document.',
                            },
                            metadata: { internal: draft.is_internal },
                        };
                    } catch (err: any) {
                        return { error: err.message };
                    }
                }

                // EDIT / REPLACE mode — reservation guarantees `existing` is set here.
                if (!existing) {
                    return { error: 'Internal error: missing artifact data for edit/replace path.' };
                }

                const docTitle = title || existing.title;
                let contentToLoad: string;
                let loadedFrom: string;
                let loadedVersion: number | null;
                let existingDocumentType: string | null = null;
                let rejectionReason: string | null = null;

                if (existing.proposedVersion !== null && existing.proposedContent !== null) {
                    contentToLoad = existing.proposedContent;
                    loadedFrom = 'proposed';
                    loadedVersion = existing.proposedVersion;
                    existingDocumentType = existing.proposedDocumentType;
                } else if (existing.approvedContent !== null) {
                    contentToLoad = existing.approvedContent;
                    loadedFrom = wasDeleted ? 'deleted' : 'approved';
                    loadedVersion = existing.approvedVersion;
                    existingDocumentType = existing.approvedDocumentType;
                } else if (existing.rejectedVersion !== null && existing.rejectedContent !== null) {
                    contentToLoad = existing.rejectedContent;
                    loadedFrom = 'rejected';
                    loadedVersion = existing.rejectedVersion;
                    existingDocumentType = existing.rejectedDocumentType;
                    rejectionReason = existing.rejectionReason;
                } else {
                    return { error: 'No version available to edit.' };
                }

                try {
                    const draftContent = mode === 'replace' ? '' : contentToLoad;
                    const draft = draftManager.begin({
                        artifactId,
                        scopeId,
                        name: normalizedName,
                        title: docTitle,
                        mode,
                        reservedVersion,
                        initialContent: draftContent,
                        ...(loadedVersion !== null ? { previousVersion: loadedVersion } : {}),
                        is_internal,
                        document_type,
                    });

                    const messages: Record<string, string> = {
                        proposed: `Continuing proposed v${loadedVersion}. Make changes, then finalize_document.`,
                        rejected: `Revising rejected v${loadedVersion}. Address feedback, then finalize_document.`,
                        approved: `Editing from approved v${loadedVersion}. Make changes, then finalize_document.`,
                        deleted: `Document was deleted (v${loadedVersion}). Loaded deleted content. Finalizing will restore it as a new proposed version.`,
                    };
                    const replaceMessage = `Replacing ${loadedFrom} v${loadedVersion}. Write the full replacement content, then finalize_document.`;

                    const loadedContentForCap = contentToLoad;
                    const includeLoadedContent =
                        (mode === 'edit' || mode === 'replace') && draftFitsBeginContentCap(loadedContentForCap);
                    const editMessageWithContent = loadedFrom
                        ? `Editing from ${loadedFrom} v${loadedVersion}. Full draft included — no separate read needed. Make changes, then finalize_document.`
                        : messages[loadedFrom];
                    const replaceMessageWithContent = loadedFrom
                        ? `Replacing ${loadedFrom} v${loadedVersion}. Prior version included below (draft is empty) — no separate read needed. Write the full replacement, then finalize_document.`
                        : replaceMessage;

                    return {
                        result: {
                            status: 'editing',
                            artifactId: draft.artifactId,
                            mode,
                            name: normalizedName,
                            title: draft.title,
                            is_internal: draft.is_internal,
                            document_type: draft.document_type,
                            ...(existingDocumentType &&
                                existingDocumentType !== document_type && {
                                    previousDocumentType: existingDocumentType,
                                }),
                            loadedFrom,
                            loadedVersion,
                            nextVersion: reservedVersion,
                            lines: countLines(draft.content),
                            message:
                                mode === 'replace'
                                    ? includeLoadedContent
                                        ? replaceMessageWithContent
                                        : replaceMessage
                                    : includeLoadedContent
                                      ? editMessageWithContent
                                      : messages[loadedFrom],
                            ...(includeLoadedContent && {
                                content: formatFullDraftContent(loadedContentForCap),
                            }),
                            ...(wasDeleted && { previouslyDeleted: true }),
                            ...(rejectionReason && { rejectionReason }),
                        },
                        metadata: { internal: draft.is_internal },
                    };
                } catch (err: any) {
                    return { error: err.message };
                }
            },
        },

        // ----------------------------------------------------------------
        // write_document - Write to editing draft
        // ----------------------------------------------------------------
        {
            name: 'write_document' as const,
            description: `Write content to the current editing draft.

Requires an active draft started with begin_document.
Content is appended to the active draft. For full rewrites of existing documents, start with begin_document(mode="replace") so the draft is empty before writing.
Content streams to the UI in real-time.
Past write_document calls may show __collapsedContent="${COLLAPSED_FIELD_SENTINEL}" — that is a system marker for omitted content, not text to write. Always generate actual document content.`,
            parameters: WriteDocumentParams,
            collapseResult: collapseWriteDocument,
            executor: (input: z.infer<typeof WriteDocumentParams>, ctx: DocumentToolsContext) => {
                const raw = (input ?? {}) as { content?: unknown; __collapsedContent?: unknown };
                const { content } = raw;
                const { draftManager } = ctx;

                // Strip stray sentinels so an echoed marker never lands in the saved document.
                const cleanedContent =
                    typeof content === 'string' ? content.replaceAll(COLLAPSED_FIELD_SENTINEL, '') : '';
                const strippedMarker = typeof content === 'string' && content !== cleanedContent;

                // `__collapsedContent` is not a real parameter, and content that is nothing but
                // the sentinel both mean the model echoed a collapsed historical marker as a live call.
                const reusedCollapsedMarker =
                    '__collapsedContent' in raw || (strippedMarker && cleanedContent.trim().length === 0);

                if (reusedCollapsedMarker) {
                    return {
                        error:
                            `"${COLLAPSED_FIELD_SENTINEL}" is a system marker for omitted historical content, not document text, and __collapsedContent is not a real argument.` +
                            'Write the actual document content in the "content" field. Use recall_tool_call if you need prior content, or read_document should that fail.',
                    };
                }

                if (typeof content !== 'string' || cleanedContent.trim().length === 0) {
                    return { error: 'write_document requires non-empty content in the "content" field.' };
                }

                try {
                    const draft = draftManager.append(cleanedContent);
                    const addedLines = countLines(cleanedContent);
                    const totalLines = countLines(draft.content);

                    return {
                        result: {
                            status: 'written',
                            charsAdded: cleanedContent.length,
                            charsWritten: cleanedContent.length,
                            linesAdded: addedLines,
                            totalLines,
                            ...(strippedMarker && {
                                note: `Stray "${COLLAPSED_FIELD_SENTINEL}" marker(s) were removed from the content before saving — never include that marker in document content.`,
                            }),
                        },
                        metadata: { internal: draft.is_internal },
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
            description: `Make precise edits to the current active draft. Requires an active draft from begin_document(mode="edit"); read_document alone is not enough. Batch multiple edits into one call when possible.

Each edit: startLine anchor + exact oldContent to find + newContent replacement.
${PATCH_DOCUMENT_ALLOW_EXPLICIT_END_LINE ? '`endLine` is optional; use it only to narrow the search window.' : 'Provide exactly `startLine`, `oldContent`, and `newContent`; the replacement span is inferred from `oldContent`.'}
IMPORTANT: \`begin_document\` \`content\`, \`touched\`, and \`read_document\` use the same \`N: \` line prefix — display-only; strip it from \`oldContent\`.
Within this one call, all edits use the same pre-edit line frame from the current draft snapshot; batch all edits for that snapshot when possible.
Edits are atomic — all succeed or none apply. On success, returns post-edit line ranges in \`touched[]\` (numbered content per region) — use these post-edit numbers to anchor the next \`patch_document\` call without a separate \`read_document\` call when they include the lines you need. If \`touched\` is omitted, truncated, or does not include the region you need, call \`read_document\` for the needed viewport.
"${COLLAPSED_FIELD_SENTINEL}" in historical edits is a system marker for omitted content, not text to use in oldContent or newContent.`,
            parameters: PatchDocumentParams,
            collapseResult: collapsePatchDocument,
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

                const hasCollapsedEdit = edits.some((edit) => {
                    const e = edit as { oldContent?: unknown; newContent?: unknown };
                    return typeof e.oldContent !== 'string' || typeof e.newContent !== 'string';
                });
                if (hasCollapsedEdit) {
                    return {
                        error:
                            'patch_document edits must contain real "oldContent" and "newContent" strings. ' +
                            `A collapsed historical edit (oldContentChars/newContentChars stats, or "${COLLAPSED_FIELD_SENTINEL}") is a system marker, ` +
                            'not a reusable argument — use recall_tool_call to retrieve the original edits.',
                    };
                }

                // oldContent may legitimately contain the sentinel (to patch corruption out of a
                // document); newContent is written verbatim, so it must never carry the marker.
                if (edits.some((edit) => edit.newContent.includes(COLLAPSED_FIELD_SENTINEL))) {
                    return {
                        error:
                            `"${COLLAPSED_FIELD_SENTINEL}" is a system marker for omitted historical content, not document text — it must not appear in an edit's newContent. ` +
                            'Provide the real replacement text. Use recall_tool_call if you need prior content.',
                    };
                }

                try {
                    const draft = draftManager.requireCurrent();

                    // Convert to EditOperation format
                    const editOps: EditOperation[] = edits.map((edit) => ({
                        startLine: edit.startLine,
                        endLine: PATCH_DOCUMENT_ALLOW_EXPLICIT_END_LINE
                            ? (edit as { endLine?: number | null }).endLine
                            : undefined,
                        oldContent: edit.oldContent,
                        newContent: edit.newContent,
                    }));

                    // Apply edits atomically
                    const result = applyEdits(draft.content, editOps);

                    if (!result.success) {
                        return { error: result.error };
                    }

                    // Update draft with new content
                    const updatedDraft = draftManager.setContent(result.newContent!);

                    // Stash canonical edits for document-events (side channel — keeps full-range content out of the model-facing tool result).
                    if (toolCallId && result.appliedEdits) {
                        draftManager.setAppliedEdits(toolCallId, result.appliedEdits);
                    }

                    const { touched, truncated } = result.appliedEdits?.length
                        ? buildPatchTouchedRegions(result.newContent!, result.appliedEdits)
                        : { touched: [], truncated: false };

                    return {
                        result: {
                            status: 'edited',
                            editsApplied: edits.length,
                            linesNow: result.linesNow,
                            ...(touched.length > 0 && { touched }),
                            ...(truncated && { truncated: true }),
                        },
                        metadata: { internal: updatedDraft.is_internal },
                    };
                } catch (err: any) {
                    return { error: err.message };
                }
            },
        },

        // ----------------------------------------------------------------
        // finalize_document - Save as proposed version or abort draft
        // ----------------------------------------------------------------
        {
            name: 'finalize_document' as const,
            description: `Finish the current editing draft.

You MUST call this after begin_document or the content will be lost.
Use action="save" to persist the draft as a proposed version.
The saved version will NOT be live until a user approves it.
If a proposed version already exists, it will be marked as "superseded".
Use action="abort" to discard the active draft without saving.`,
            parameters: FinalizeDocumentParams,
            executor: async (input: z.infer<typeof FinalizeDocumentParams>, ctx: DocumentToolsContext, rCtx?: Ctx) => {
                const { em, lockService, chatId, draftManager, embeddingQueue, createdVersionIds } = ctx;
                const scope = getScope(ctx);

                try {
                    const draft = draftManager.requireCurrent();
                    const action = input?.action ?? 'save';

                    if (action === 'abort') {
                        const discardedLines = countLines(draft.content);
                        // Remove the empty ArtifactEntity that reserveDraftVersion created
                        // for a brand-new key, so list_documents doesn't show a phantom row.
                        // No-op when other versions already exist (edit/replace abort path).
                        await cleanupOrphanArtifact({ em, lockService, scope, name: draft.name });
                        draftManager.discard();
                        return {
                            result: {
                                action: 'aborted',
                                artifactId: draft.artifactId,
                                name: draft.name,
                                lines: discardedLines,
                                status: 'aborted',
                            },
                            metadata: { internal: draft.is_internal },
                            message: `Aborted draft "${draft.name}" without saving.`,
                        };
                    }

                    // Persist to database as proposed
                    const result = await upsertDocument({
                        em,
                        lockService,
                        scope,
                        chatId,
                        name: draft.name,
                        title: draft.title,
                        content: draft.content,
                        is_internal: draft.is_internal,
                        document_type: draft.document_type,
                        reservedVersion: draft.reservedVersion,
                    });

                    // Track version for linking to assistant message later
                    createdVersionIds.push(result.versionId);

                    // Notify listener (user-scoped broadcast)
                    ctx.onVersionCreated?.({
                        artifactName: draft.name,
                        versionId: result.versionId,
                        version: result.version,
                        action: result.action,
                        status: result.status,
                        documentType: draft.document_type,
                    });

                    draftManager.discard();

                    // ── Completion Brief tracking ────────────────────────────
                    if (result.status === 'proposed' && draft.document_type === 'Completion Brief') {
                        const chatEntity = await em.findOne(ChatEntity, { id: chatId });
                        if (chatEntity) {
                            chatEntity.completion_brief = em.getReference('ArtifactEntity', result.artifactId) as any;
                            chatEntity.completion_brief_status = 'proposed';
                            await em.flush();
                        }
                    }

                    // ── Embedding (fire-and-forget, non-blocking) ────────
                    if (result.status === 'proposed' && embeddingQueue && (ctx.projectId || ctx.chatId)) {
                        const embedPromise = embeddingQueue
                            .send({
                                type: 'index_artifact_version',
                                projectId: ctx.projectId ?? null,
                                chatId: ctx.chatId ?? null,
                                versionId: result.versionId,
                                content: draft.content,
                                documentName: draft.name,
                                previewAlias: ctx.previewAlias,
                            })
                            .catch((err) => console.error('[finalize_document] Embed error:', err));

                        rCtx?.eCtx?.waitUntil(embedPromise);
                    }

                    const toolResult: Record<string, unknown> = {
                        action: result.action,
                        artifactId: result.artifactId,
                        name: draft.name,
                        version: result.version,
                        status: result.status,
                        lines: result.lines,
                    };

                    const response: Record<string, unknown> = {
                        result: toolResult,
                        metadata: { internal: draft.is_internal },
                        appendedOutput: `::document[${draft.name}]{version=${result.version} lines=${result.lines} documentType="${draft.document_type}"}`,
                        message: `Saved as proposed v${result.version}. Awaiting user approval to become live. STOP HERE — do not create any more documents until the user asks.`,
                    };

                    if (result.supersededVersion) {
                        toolResult.supersededVersion = result.supersededVersion;
                        response.supersededVersion = result.supersededVersion;
                        response.message = `Saved as proposed v${result.version}. Previous proposed v${result.supersededVersion} was superseded. STOP HERE — do not create any more documents until the user asks.`;
                    }

                    if (result.supersededByVersion) {
                        toolResult.supersededByVersion = result.supersededByVersion;
                        response.supersededByVersion = result.supersededByVersion;
                        response.message = `Saved as superseded v${result.version} because newer proposed v${result.supersededByVersion} already exists. STOP HERE — do not create any more documents until the user asks.`;
                    }

                    // ── Internal Summary (auto-generated drawer brief) ──────────
                    // Run a separate inference call against the just-finalized parent
                    // version. The generator streams summary_* events to the SSE
                    // pipeline and writes the final text into version.summary_internal.
                    // Awaited synchronously: the agent's own response is held until
                    // the summary completes, which keeps the SSE stream alive and
                    // the frontend drawer in lockstep with the parent doc.
                    if (
                        result.status === 'proposed' &&
                        rCtx &&
                        shouldGenerateInternalSummary(draft.document_type) &&
                        draft.is_internal
                    ) {
                        toolResult.summaryPending = true;
                        try {
                            await generateInternalSummary({
                                rCtx,
                                em,
                                versionId: result.versionId,
                                artifactId: result.artifactId,
                                version: result.version,
                                documentName: draft.name,
                                documentType: draft.document_type,
                                content: draft.content,
                                pushStreamEvents: ctx.pushStreamEvents,
                                hadPriorSummary: Boolean(result.supersededSummaryInternal),
                            });
                        } catch (err) {
                            console.error('[finalize_document] summary generator failed:', err);
                            // Soft-fail: parent doc is already saved. Surface to agent
                            // but don't block the response.
                            toolResult.summaryError = err instanceof Error ? err.message : String(err);
                        }
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
            collapseResult: collapseReadDocument,
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
                        result: {
                            source: 'editing_draft',
                            name: normalizedName,
                            totalLines: viewport.totalLines,
                            viewport: { startLine: viewport.startLine, endLine: viewport.endLine },
                            content: viewport.content,
                            message: 'Reading from your current editing session (not yet saved).',
                        },
                        metadata: { internal: draft.is_internal },
                    };
                }

                // Fetch from database
                const doc = await findDocumentByName(em, scope, normalizedName);
                if (!doc) {
                    return {
                        error: `Document "${normalizedName}" not found. Call request_user_decision with options create_new ("Create a new document with this name"), search ("Search for a similar document first"), and pick_from_list ("Show me the existing documents"). Do NOT silently guess a different name.`,
                    };
                }

                // Determine which content to return based on version mode
                let content: string | null = null;
                let source: string;
                let version: number | null = null;
                let isInternal = true;

                switch (versionMode) {
                    case 'approved':
                        content = doc.approvedContent;
                        version = doc.approvedVersion;
                        source = 'approved';
                        isInternal = doc.approvedIsInternal ?? true;
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
                        isInternal = doc.proposedIsInternal ?? true;
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
                            isInternal = doc.proposedIsInternal ?? true;
                        } else if (doc.approvedContent !== null) {
                            content = doc.approvedContent;
                            version = doc.approvedVersion;
                            source = 'approved';
                            isInternal = doc.approvedIsInternal ?? true;
                        } else if (doc.rejectedContent !== null) {
                            content = doc.rejectedContent;
                            version = doc.rejectedVersion;
                            source = 'rejected';
                            isInternal = doc.rejectedIsInternal ?? true;
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
                          : (doc.approvedDocumentType ?? 'Other');

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
                            metadata: { internal: isInternal },
                            imageRefs: hydrated.imageRefs,
                            contentParts: hydrated.contentParts,
                        };
                    }
                }

                return { result: response, metadata: { internal: isInternal } };
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

This queues embedding indexing for the approved version.`,
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
