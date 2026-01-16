/**
 * Document Tools
 *
 * Tools for managing documents in the project knowledge base.
 * Follows the pattern from prompt-management.ts.
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
    updateDocumentContent,
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
    guidance:
        'Use write_document for one-shot creation. Use begin/continue/finish for complex multi-step writing where you need to pause and reason.',
    tools: [
        'write_document',
        'begin_document',
        'continue_document',
        'finish_document',
        'read_document',
        'edit_document',
        'list_documents',
    ],
};

// ============================================================================
// SCHEMAS
// ============================================================================

const WriteDocumentParams = z.object({
    name: z.string().min(1).describe('Document name (e.g., "market-analysis.md"). Extension auto-appended if missing.'),
    overwrite: z
        .boolean()
        .optional()
        .nullable()
        .describe('Set true to replace an existing document. Fails if document exists and not set.'),
    title: z.string().min(1).describe('Display title for the document.'),
    content: z.string().describe('Full document content in markdown.'),
});

const BeginDocumentParams = z.object({
    name: z.string().min(1).describe('Document name (e.g., "market-analysis.md"). Extension auto-appended if missing.'),
    title: z.string().min(1).describe('Display title for the document.'),
});

const ContinueDocumentParams = z.object({
    name: z.string().min(1).describe('Document name of the active draft.'),
    content: z.string().describe('Content to append to the draft.'),
});

const FinishDocumentParams = z.object({
    name: z.string().min(1).describe('Document name of the draft to commit.'),
});

const ReadDocumentParams = z.object({
    name: z.string().min(1).describe('Document name to read.'),
    startLine: z.number().int().positive().optional().nullable().describe('First line to return (1-indexed).'),
    endLine: z.number().int().positive().optional().nullable().describe('Last line to return (inclusive).'),
});

const EditDocumentParams = z.object({
    name: z.string().min(1).describe('Document name to edit.'),
    edits: z
        .array(
            z.object({
                startLine: z.number().int().positive().describe('Start of search range (1-indexed).'),
                endLine: z.number().int().positive().describe('End of search range (inclusive).'),
                oldContent: z.string().describe('Exact content to find and replace.'),
                newContent: z.string().describe('Replacement content.'),
            }),
        )
        .min(1)
        .describe('List of edit operations to apply atomically.'),
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
        // write_document - One-shot create/replace
        // ----------------------------------------------------------------
        {
            name: 'write_document' as const,
            description:
                'Create or replace a document. If the document already exists, you must set overwrite: true or the call will fail. If unsure whether it exists, try without overwrite first.',
            parameters: WriteDocumentParams,
            earlyValidate: async (accumulated: string, ctx: DocumentToolsContext) => {
                // Parse partial JSON to extract name and overwrite
                let parsed: { name?: string; overwrite?: boolean } | null = null;
                try {
                    parsed = JSON.parse(accumulated);
                } catch {
                    /* incomplete JSON */
                }
                if (!parsed?.name) return null; // Not ready

                const normalizedName = normalizeDocumentName(parsed.name);
                const exists = await findDocumentByName(ctx.em, ctx.projectId, normalizedName);

                if (exists && !parsed.overwrite) {
                    return `Document '${normalizedName}' already exists (v${exists.version}). Set overwrite: true to replace.`;
                }
                return true; // Valid
            },
            executor: async (input: z.infer<typeof WriteDocumentParams>, ctx: DocumentToolsContext) => {
                const { name, title, content } = input;
                const { em, projectId, chatId, draftManager } = ctx;

                const normalizedName = normalizeDocumentName(name);

                // Clear any existing draft for this document
                draftManager.delete(projectId, normalizedName);

                // Upsert to database
                const result = await upsertDocument(em, projectId, chatId, normalizedName, title, content);

                return {
                    result,
                    appendedOutput: `::document[${normalizedName}]{version=${result.version} action=${result.action} lines=${result.lines}}`,
                };
            },
        },

        // ----------------------------------------------------------------
        // begin_document - Start draft session
        // ----------------------------------------------------------------
        {
            name: 'begin_document' as const,
            description:
                'Start a multi-step draft session. Use this when you need to pause mid-document to reason, read what you wrote, or make edits before committing. If the document exists, the draft is pre-loaded with current content. You MUST call finish_document when done or the content will be lost.',
            parameters: BeginDocumentParams,
            executor: async (input: z.infer<typeof BeginDocumentParams>, ctx: DocumentToolsContext) => {
                const { name, title } = input;
                const { em, projectId, draftManager } = ctx;

                const normalizedName = normalizeDocumentName(name);

                // Check if draft already exists
                if (draftManager.has(projectId, normalizedName)) {
                    return {
                        error: `Draft already active for '${normalizedName}'. Use continue_document or finish_document.`,
                    };
                }

                // Check if document exists in DB
                const existing = await findDocumentByName(em, projectId, normalizedName);

                if (existing) {
                    // Create draft with existing content
                    const session = draftManager.create(
                        projectId,
                        normalizedName,
                        title,
                        existing.content,
                        true,
                        existing.version,
                    );

                    return {
                        action: 'replacing' as const,
                        name: normalizedName,
                        mode: 'draft' as const,
                        draftLines: countLines(session.content),
                        previousVersion: existing.version,
                    };
                } else {
                    // Create empty draft
                    draftManager.create(projectId, normalizedName, title, '', false);

                    return {
                        action: 'creating' as const,
                        name: normalizedName,
                        mode: 'draft' as const,
                        draftLines: 0,
                    };
                }
            },
        },

        // ----------------------------------------------------------------
        // continue_document - Append to draft
        // ----------------------------------------------------------------
        {
            name: 'continue_document' as const,
            description:
                'Append content to an active draft session. Content streams in real-time. Requires an active draft started with begin_document.',
            parameters: ContinueDocumentParams,
            executor: (input: z.infer<typeof ContinueDocumentParams>, ctx: DocumentToolsContext) => {
                const { name, content } = input;
                const { projectId, draftManager } = ctx;

                const normalizedName = normalizeDocumentName(name);

                const session = draftManager.append(projectId, normalizedName, content);

                if (!session) {
                    return {
                        error: `No active draft for '${normalizedName}'. Use begin_document first.`,
                    };
                }

                const appendedLines = countLines(content);
                const totalLines = countLines(session.content);

                return {
                    mode: 'draft' as const,
                    name: normalizedName,
                    appendedLines,
                    draftLines: totalLines,
                };
            },
        },

        // ----------------------------------------------------------------
        // finish_document - Commit draft
        // ----------------------------------------------------------------
        {
            name: 'finish_document' as const,
            description:
                'Commit the draft and save to database. You MUST call this after begin_document or the content will be lost when the session ends.',
            parameters: FinishDocumentParams,
            executor: async (input: z.infer<typeof FinishDocumentParams>, ctx: DocumentToolsContext) => {
                const { name } = input;
                const { em, projectId, chatId, draftManager } = ctx;

                const normalizedName = normalizeDocumentName(name);

                const session = draftManager.get(projectId, normalizedName);

                if (!session) {
                    return {
                        error: `No active draft for '${normalizedName}'. Use begin_document first.`,
                    };
                }

                // Commit to database
                const dbResult = await upsertDocument(
                    em,
                    projectId,
                    chatId,
                    normalizedName,
                    session.title,
                    session.content,
                );

                // Clear draft
                draftManager.delete(projectId, normalizedName);

                return {
                    result: {
                        action: 'committed' as const,
                        name: normalizedName,
                        version: dbResult.version,
                        lines: dbResult.lines,
                    },
                    appendedOutput: `::document[${normalizedName}]{version=${dbResult.version} action=committed lines=${dbResult.lines}}`,
                };
            },
        },

        // ----------------------------------------------------------------
        // read_document - View with viewport
        // ----------------------------------------------------------------
        {
            name: 'read_document' as const,
            description:
                'View document content with optional line range (viewport). If you have an active draft session for this document, returns the draft content. Otherwise returns the committed version. Response includes mode: "draft" | "committed" to indicate which you\'re viewing.',
            parameters: ReadDocumentParams,
            executor: async (input: z.infer<typeof ReadDocumentParams>, ctx: DocumentToolsContext) => {
                const { name, startLine, endLine } = input;
                const { em, projectId, draftManager } = ctx;

                const normalizedName = normalizeDocumentName(name);

                // Check for active draft first
                const draft = draftManager.get(projectId, normalizedName);

                if (draft) {
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
                        error: `Document '${normalizedName}' not found. Use write_document or begin_document to create it.`,
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
        // edit_document - Precision edits
        // ----------------------------------------------------------------
        {
            name: 'edit_document' as const,
            description:
                'Make precise edits to a document using line ranges and exact content matching. If you have an active draft session for this document, edits the draft. Otherwise edits the committed version (creates a new version). Response includes mode: "draft" | "committed" to indicate which you edited.',
            parameters: EditDocumentParams,
            executor: async (input: z.infer<typeof EditDocumentParams>, ctx: DocumentToolsContext) => {
                const { name, edits } = input;
                const { em, projectId, draftManager } = ctx;

                const normalizedName = normalizeDocumentName(name);

                // Check for active draft first
                const draft = draftManager.get(projectId, normalizedName);

                if (draft) {
                    // Edit draft
                    const editOps: EditOperation[] = edits.map((e) => ({
                        startLine: e.startLine,
                        endLine: e.endLine,
                        oldContent: e.oldContent,
                        newContent: e.newContent,
                    }));

                    const result = applyEdits(draft.content, editOps);

                    if (!result.success) {
                        return { error: result.error };
                    }

                    draftManager.updateContent(projectId, normalizedName, result.newContent!);

                    return {
                        mode: 'draft' as const,
                        name: normalizedName,
                        editsApplied: edits.length,
                        linesNow: result.linesNow,
                    };
                }

                // Edit committed version
                const doc = await findDocumentByName(em, projectId, normalizedName);

                if (!doc) {
                    return {
                        error: `Document '${normalizedName}' not found. Use write_document or begin_document to create it.`,
                    };
                }

                const editOps: EditOperation[] = edits.map((e) => ({
                    startLine: e.startLine,
                    endLine: e.endLine,
                    oldContent: e.oldContent,
                    newContent: e.newContent,
                }));

                const result = applyEdits(doc.content, editOps);

                if (!result.success) {
                    return { error: result.error };
                }

                // Save new version
                const updateResult = await updateDocumentContent(em, projectId, normalizedName, result.newContent!);

                if (!updateResult) {
                    return { error: 'Failed to save changes.' };
                }

                return {
                    mode: 'committed' as const,
                    name: normalizedName,
                    editsApplied: edits.length,
                    linesNow: updateResult.linesNow,
                    version: updateResult.version,
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
