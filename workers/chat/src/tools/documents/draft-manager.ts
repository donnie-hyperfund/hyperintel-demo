/**
 * Draft Buffer Manager
 *
 * Manages in-memory draft sessions for multi-step document creation/editing.
 *
 * Key insight: Tool streaming is SEQUENTIAL (verified via test).
 * When write_document starts, begin_document has already completed.
 * This means we only need to track ONE current draft at a time.
 */

import type { AppliedEdit } from './document-service';

export interface DraftSession {
    /** Document name (with .md extension) */
    name: string;
    title: string;
    /** Scope identifier (projectId or userId depending on context) */
    scopeId: string;
    content: string;
    /** Draft mode: create new, replace existing, or edit existing */
    mode: 'create' | 'replace' | 'edit';
    /** Previous version number (for replace/edit modes) */
    previousVersion?: number;
    /** Whether this is an internal document (content redacted from frontend) */
    is_internal: boolean;
    /** Document type classification */
    document_type: string;
    /** For PECP: the parent internal document version ID this summary is linked to */
    parentVersionId?: string;
    createdAt: Date;
}

/**
 * In-memory draft manager.
 * Tracks the current active draft for sequential tool execution.
 *
 * Flow:
 * 1. begin_document → creates draft, sets as current
 * 2. write_document → appends to current draft
 * 3. edit_draft → modifies current draft
 * 4. finalize_document → commits current draft, clears it
 */
export class DraftManager {
    /** The currently active draft (one at a time due to sequential execution) */
    private currentDraft: DraftSession | null = null;

    /** Side channel: canonical applied edits from patch_document, keyed by tool_call_id. Consumed once by document-events. */
    private appliedEditsByToolCall = new Map<string, AppliedEdit[]>();

    /**
     * Create a new draft session and set it as current.
     * @throws Error if there's already an active draft (must finalize first)
     */
    begin(
        scopeId: string,
        name: string,
        title: string,
        mode: 'create' | 'replace' | 'edit',
        initialContent = '',
        previousVersion?: number,
        is_internal = true,
        document_type = 'Other',
        parentVersionId?: string,
    ): DraftSession {
        if (this.currentDraft) {
            throw new Error(
                `Cannot begin draft for "${name}" - already have active draft "${this.currentDraft.name}". ` +
                    `Call finalize_document first.`,
            );
        }

        this.currentDraft = {
            name,
            title,
            scopeId,
            content: initialContent,
            mode,
            previousVersion,
            is_internal,
            document_type,
            parentVersionId,
            createdAt: new Date(),
        };
        return this.currentDraft;
    }

    /**
     * Get the current active draft.
     */
    getCurrent(): DraftSession | null {
        return this.currentDraft;
    }

    /**
     * Get current draft or throw if none active.
     */
    requireCurrent(): DraftSession {
        if (!this.currentDraft) {
            throw new Error('No active draft. Call begin_document first.');
        }
        return this.currentDraft;
    }

    /**
     * Append content to the current draft.
     */
    append(content: string): DraftSession {
        const draft = this.requireCurrent();
        draft.content += content;
        return draft;
    }

    /**
     * Perform search/replace on the current draft.
     * @returns Number of replacements made
     */
    searchReplace(search: string, replace: string): number {
        const draft = this.requireCurrent();
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = draft.content.match(regex);
        const count = matches?.length ?? 0;
        draft.content = draft.content.replace(regex, replace);
        return count;
    }

    /**
     * Update entire content of the current draft.
     */
    setContent(content: string): DraftSession {
        const draft = this.requireCurrent();
        draft.content = content;
        return draft;
    }

    /**
     * Finalize (commit) the current draft and clear it.
     * Returns the draft data for persistence.
     */
    finalize(): DraftSession {
        const draft = this.requireCurrent();
        this.currentDraft = null;
        return draft;
    }

    /**
     * Discard the current draft without committing.
     */
    discard(): void {
        this.currentDraft = null;
    }

    /** Stash canonical applied edits for later read by document-events (keyed by tool_call_id). */
    setAppliedEdits(toolCallId: string, edits: AppliedEdit[]): void {
        this.appliedEditsByToolCall.set(toolCallId, edits);
    }

    /** Read and remove stashed applied edits for a given tool_call_id. */
    takeAppliedEdits(toolCallId: string): AppliedEdit[] | undefined {
        const edits = this.appliedEditsByToolCall.get(toolCallId);
        this.appliedEditsByToolCall.delete(toolCallId);
        return edits;
    }

    /**
     * Check if there's an active draft.
     */
    hasActive(): boolean {
        return this.currentDraft !== null;
    }

    /**
     * Clear all state (e.g., on session end).
     */
    clear(): void {
        this.currentDraft = null;
        this.appliedEditsByToolCall.clear();
    }
}

/** Singleton instance for the current process */
let globalDraftManager: DraftManager | null = null;

/**
 * Get or create the global draft manager instance.
 * In a real deployment, this would be scoped to the request/chat session.
 */
export function getDraftManager(): DraftManager {
    if (!globalDraftManager) {
        globalDraftManager = new DraftManager();
    }
    return globalDraftManager;
}
