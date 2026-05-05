/**
 * Computes the base localStorage key for a draft session (text input).
 * Accepts `string` for chatType so this utility stays independent of module-level types.
 */
export function getDraftBaseKey(chatType: string, chatId: string | null, projectId?: string): string {
    if (chatId) return `draft:${chatType}:${chatId}`;
    if (projectId) return `draft:${chatType}:${projectId}:new`;
    return `draft:${chatType}:new`;
}

/**
 * Computes the localStorage key for persisting in-progress file upload entries.
 * Returns `null` when there isn't enough scope info to form a key.
 */
export function getUploadStorageKey(scope?: { projectId?: string; chatId?: string }, isDraft = false): string | null {
    if (isDraft) {
        if (scope?.chatId) return `draft-uploads:${scope.chatId}`;
        if (scope?.projectId) return `draft-uploads:${scope.projectId}:new`;
        return null;
    }
    if (scope?.projectId) return `resource-uploads:${scope.projectId}`;
    return null;
}

/** sessionStorage key for tracking in-flight artifact approval/rejection operations. */
export const ARTIFACT_PROCESSING_KEY = 'artifact-processing';

/** sessionStorage key for chat IDs that need a nudge after a locally-initiated approval/rejection. */
export const NUDGE_PENDING_KEY = 'nudge-pending';

/** sessionStorage key prefix for per-chat context-warning bypass ("don't remind me again this session"). */
export const CB_BYPASS_KEY_PREFIX = 'cb-bypass';
