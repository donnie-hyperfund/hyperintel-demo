/**
 * Draft Buffer Manager
 *
 * Manages in-memory draft sessions for multi-step document creation/editing.
 * Drafts are keyed by (projectId, documentName) and stored until committed or discarded.
 */

export interface DraftSession {
    /** Document name (with .md extension) */
    name: string;
    title: string;
    projectId: string;
    content: string;
    /** True if replacing existing document, false if creating new */
    isReplacing: boolean;
    previousVersion?: number;
    createdAt: Date;
}

/**
 * In-memory draft manager.
 * Instance should be shared across a single chat session.
 */
export class DraftManager {
    private drafts = new Map<string, DraftSession>();

    private makeKey(projectId: string, name: string): string {
        return `${projectId}::${name}`;
    }

    /**
     * Get active draft for a document.
     */
    get(projectId: string, name: string): DraftSession | undefined {
        return this.drafts.get(this.makeKey(projectId, name));
    }

    /**
     * Check if a draft exists for a document.
     */
    has(projectId: string, name: string): boolean {
        return this.drafts.has(this.makeKey(projectId, name));
    }

    /**
     * Create a new draft session.
     * @param initialContent - For replacing existing docs, pass current content. For new docs, pass empty string.
     */
    create(
        projectId: string,
        name: string,
        title: string,
        initialContent = '',
        isReplacing = false,
        previousVersion?: number,
    ): DraftSession {
        const session: DraftSession = {
            name,
            title,
            projectId,
            content: initialContent,
            isReplacing,
            previousVersion,
            createdAt: new Date(),
        };
        this.drafts.set(this.makeKey(projectId, name), session);
        return session;
    }

    /**
     * Append content to an existing draft.
     */
    append(projectId: string, name: string, content: string): DraftSession | undefined {
        const session = this.get(projectId, name);
        if (session) {
            session.content += content;
        }
        return session;
    }

    /**
     * Update entire content of a draft (for edits).
     */
    updateContent(projectId: string, name: string, content: string): DraftSession | undefined {
        const session = this.get(projectId, name);
        if (session) {
            session.content = content;
        }
        return session;
    }

    /**
     * Delete a draft session.
     */
    delete(projectId: string, name: string): boolean {
        return this.drafts.delete(this.makeKey(projectId, name));
    }

    /**
     * Get all active drafts for a project.
     */
    listForProject(projectId: string): DraftSession[] {
        const result: DraftSession[] = [];
        for (const session of this.drafts.values()) {
            if (session.projectId === projectId) {
                result.push(session);
            }
        }
        return result;
    }

    /**
     * Clear all drafts (e.g., on session end).
     */
    clear(): void {
        this.drafts.clear();
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
