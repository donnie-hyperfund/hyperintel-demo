/**
 * Computes the base localStorage key for a draft session.
 * Accepts `string` for chatType so this utility stays independent of module-level types.
 */
export function getDraftBaseKey(chatType: string, chatId: string | null, projectId?: string): string {
    if (chatId) return `draft:${chatType}:${chatId}`;
    if (projectId) return `draft:${chatType}:${projectId}:new`;
    return `draft:${chatType}:new`;
}

/** Derives localStorage sub-keys for a given draft session base key. */
export function draftStorageKeys(baseKey: string) {
    return {
        uploadedFiles: `${baseKey}:uploaded-files`,
    } as const;
}
