/**
 * Document Tools - Multi-Call Architecture
 *
 * Tools for managing documents using a begin → write/edit → finalize pattern.
 * This design leverages sequential tool streaming for optimal UX.
 *
 * Flow:
 * 1. begin_document(mode, name, title?) → creates draft
 * 2. write_document(content) or edit_draft(search, replace) → modify draft
 * 3. finalize_document() → commits to database
 */

import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import type { EntityManager } from '@mikro-orm/core';
import { z } from 'zod';
import {
    applyEdits,
    countLines,
    type EditOperation,
    extractViewport,
    findDocumentByName,
    listDocuments as listDocumentsDb,
    normalizeDocumentName,
    upsertDocument,
} from './document-service';
import { DraftManager } from './draft-manager';

// ============================================================================
// TYPES
// ============================================================================

export interface DocumentToolsContext {
    /** Entity manager for DB operations */
    em: EntityManager;
    /** Current project ID */
    projectId: string;
    /** Current chat ID (for traceability) */
    chatId: string;
    /** Draft manager instance */
    draftManager: DraftManager;
}

// ============================================================================
// TOOL GROUP
// ============================================================================

export const DocumentToolGroup: AgentToolGroup = {
    name: 'Document Management',
    slug: 'document_',
    description: 'Tools for creating, reading, and editing documents in the project knowledge base.',
    guidance: `For document creation/editing, use the multi-call pattern:
1. begin_document(mode, name, title?) - Start draft
2. write_document(content) - Add content (can call multiple times)
3. patch_document(edits) - Precision line-based edits (optional)
4. finalize_document() - Commit to database

You MUST call finalize_document when done or content will be lost.`,
    tools: [
        'begin_document',
        'write_document',
        'patch_document',
        'finalize_document',
        'read_document',
        'list_documents',
    ],
};

// ============================================================================
// SCHEMAS
// ============================================================================

const BeginDocumentParams = z.object({
    mode: z
        .enum(['create', 'replace', 'edit'])
        .describe(
            'Operation mode: "create" (fails if exists), "replace" (fails if not exists), "edit" (loads existing content)',
        ),
    name: z.string().min(1).describe('Document name (e.g., "analysis.md"). Extension auto-appended if missing.'),
    title: z.string().optional().nullable().describe('Display title for the document (required for create/replace).'),
});

const WriteDocumentParams = z.object({
    content: z.string().describe('Content to append to the current draft.'),
});

const PatchDocumentParams = z.object({
    edits: z
        .array(
            z.object({
                startLine: z.number().int().positive().describe('Start of search range (1-indexed).'),
                endLine: z.number().int().positive().describe('End of search range (inclusive).'),
                oldContent: z.string().describe('Exact content to find and replace within the line range.'),
                newContent: z.string().describe('Replacement content.'),
            }),
        )
        .min(1)
        .describe('List of edit operations to apply atomically.'),
});

const FinalizeDocumentParams = z.object({});

const ReadDocumentParams = z.object({
    name: z.string().min(1).describe('Document name to read.'),
    startLine: z.number().int().positive().optional().nullable().describe('First line to return (1-indexed).'),
    endLine: z.number().int().positive().optional().nullable().describe('Last line to return (inclusive).'),
});

const ListDocumentsParams = z.object({
    search: z.string().optional().nullable().describe('Optional filter by name/title substring.'),
});

// ============================================================================
// TOOL FACTORY
// ============================================================================

export function createDocumentTools() {
    return [
        // ----------------------------------------------------------------
        // begin_document - Start draft session
        // ----------------------------------------------------------------
        {
            name: 'begin_document' as const,
            description: `Start a document draft session.

Modes:
- "create": Create new document (fails if exists)
- "replace": Replace existing document (fails if not exists)  
- "edit": Edit existing document (loads current content, fails if not exists)

After calling this, use write_document to add content or patch_document for precise edits.
You MUST call finalize_document when done or content will be lost.`,
            parameters: BeginDocumentParams,
            executor: async (input: z.infer<typeof BeginDocumentParams>, ctx: DocumentToolsContext) => {
                const { mode, name, title } = input;
                const { em, projectId, draftManager } = ctx;

                const normalizedName = normalizeDocumentName(name);

                // Check for existing document
                const existing = await findDocumentByName(em, projectId, normalizedName);

                // Validate based on mode
                if (mode === 'create' && existing) {
                    return {
                        error: `Document "${normalizedName}" already exists (v${existing.version}). Use mode="replace" to overwrite.`,
                    };
                }
                if ((mode === 'replace' || mode === 'edit') && !existing) {
                    return {
                        error: `Document "${normalizedName}" does not exist. Use mode="create" for new documents.`,
                    };
                }

                // Require title for create/replace
                const docTitle = title || existing?.title || normalizedName;
                if ((mode === 'create' || mode === 'replace') && !title) {
                    // Auto-generate title from name if not provided
                }

                // Create draft
                const initialContent = mode === 'edit' ? existing?.content || '' : '';
                const previousVersion = existing?.version;

                try {
                    const draft = draftManager.begin(
                        projectId,
                        normalizedName,
                        docTitle,
                        mode,
                        initialContent,
                        previousVersion,
                    );

                    return {
                        status: 'draft' as const,
                        mode,
                        name: normalizedName,
                        title: draft.title,
                        pendingVersion: (previousVersion ?? 0) + 1,
                        lines: countLines(draft.content),
                        message:
                            mode === 'edit'
                                ? `Loaded existing content (${countLines(draft.content)} lines). Use patch_document for changes, then finalize_document.`
                                : `Draft started. Use write_document to add content, then finalize_document.`,
                    };
                } catch (err: any) {
                    return { error: err.message };
                }
            },
        },

        // ----------------------------------------------------------------
        // write_document - Append to draft
        // ----------------------------------------------------------------
        {
            name: 'write_document' as const,
            description: `Append content to the current document draft.

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
                        status: 'written' as const,
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
            description: `Make precise edits to the current draft using line ranges and exact content matching.

Requires an active draft started with begin_document.
Each edit specifies a line range to search within, the exact content to find, and the replacement.
Edits are applied atomically - all must succeed or none are applied.`,
            parameters: PatchDocumentParams,
            executor: (input: z.infer<typeof PatchDocumentParams>, ctx: DocumentToolsContext) => {
                const { edits } = input;
                const { draftManager } = ctx;

                try {
                    const draft = draftManager.requireCurrent();

                    // Convert to EditOperation format
                    const editOps: EditOperation[] = edits.map((e) => ({
                        startLine: e.startLine,
                        endLine: e.endLine,
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

                    return {
                        status: 'edited' as const,
                        editsApplied: edits.length,
                        linesNow: result.linesNow,
                    };
                } catch (err: any) {
                    return { error: err.message };
                }
            },
        },

        // ----------------------------------------------------------------
        // finalize_document - Commit draft
        // ----------------------------------------------------------------
        {
            name: 'finalize_document' as const,
            description: `Commit the current draft to the database.

You MUST call this after begin_document or the content will be lost.
Returns the final version number and line count.`,
            parameters: FinalizeDocumentParams,
            executor: async (_input: z.infer<typeof FinalizeDocumentParams>, ctx: DocumentToolsContext) => {
                const { em, projectId, chatId, draftManager } = ctx;

                try {
                    const draft = draftManager.finalize();

                    // Persist to database
                    const result = await upsertDocument(em, projectId, chatId, draft.name, draft.title, draft.content);

                    return {
                        result: {
                            action: result.action,
                            name: draft.name,
                            version: result.version,
                            lines: result.lines,
                        },
                        appendedOutput: `::document[${draft.name}]{version=${result.version} action=${result.action} lines=${result.lines}}`,
                    };
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

If you have an active draft for this document, returns the draft content.
Otherwise returns the committed version.
Response includes mode: "draft" | "committed" to indicate which you're viewing.`,
            parameters: ReadDocumentParams,
            executor: async (input: z.infer<typeof ReadDocumentParams>, ctx: DocumentToolsContext) => {
                const { name, startLine, endLine } = input;
                const { em, projectId, draftManager } = ctx;

                const normalizedName = normalizeDocumentName(name);

                // Check for active draft first
                const draft = draftManager.getCurrent();
                if (draft && draft.name === normalizedName) {
                    const viewport = extractViewport(draft.content, startLine ?? undefined, endLine ?? undefined);
                    return {
                        mode: 'draft' as const,
                        name: normalizedName,
                        totalLines: viewport.totalLines,
                        viewport: { startLine: viewport.startLine, endLine: viewport.endLine },
                        content: viewport.content,
                    };
                }

                // Check committed version
                const doc = await findDocumentByName(em, projectId, normalizedName);
                if (!doc) {
                    return {
                        error: `Document "${normalizedName}" not found. Use begin_document to create it.`,
                    };
                }

                const viewport = extractViewport(doc.content, startLine ?? undefined, endLine ?? undefined);
                return {
                    mode: 'committed' as const,
                    name: normalizedName,
                    version: doc.version,
                    totalLines: viewport.totalLines,
                    viewport: { startLine: viewport.startLine, endLine: viewport.endLine },
                    content: viewport.content,
                };
            },
        },

        // ----------------------------------------------------------------
        // list_documents - Browse
        // ----------------------------------------------------------------
        {
            name: 'list_documents' as const,
            description: 'List all documents in the project knowledge base.',
            parameters: ListDocumentsParams,
            executor: async (input: z.infer<typeof ListDocumentsParams>, ctx: DocumentToolsContext) => {
                const { search } = input;
                const { em, projectId } = ctx;

                const documents = await listDocumentsDb(em, projectId, search ? { search } : undefined);

                return {
                    documents: documents.map((d) => ({
                        name: d.name,
                        title: d.title,
                        lines: d.lines,
                        version: d.version,
                    })),
                };
            },
        },
    ] as const;
}
