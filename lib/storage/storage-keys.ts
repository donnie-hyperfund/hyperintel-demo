import type { ChatType } from '@/modules/chat/types';

export type UploadScope =
    | { kind: 'project-resources'; projectId: string }
    | { kind: 'chat-input'; chatType: ChatType; projectId?: string; chatId?: string };

type ChatInputScope = Extract<UploadScope, { kind: 'chat-input' }>;

export function uploadStorageKey(scope: UploadScope): string {
    if (scope.kind === 'project-resources') {
        return `resource-uploads:project:${scope.projectId}`;
    }
    const session = scope.projectId ? `project:${scope.projectId}` : `chat:${scope.chatType}`;
    return scope.chatId ? `chat-uploads:${session}:chat:${scope.chatId}` : `chat-uploads:${session}:new`;
}

export function draftKey(scope: ChatInputScope): string {
    return `draft:${uploadStorageKey(scope)}`;
}

// new → created: the in-place session just got its chatId. Provider migrates persisted entries.
export function isUploadScopePromotion(previous: UploadScope, next: UploadScope): boolean {
    if (previous.kind !== 'chat-input' || next.kind !== 'chat-input') return false;
    if (previous.chatType !== next.chatType) return false;
    if (previous.projectId !== next.projectId) return false;
    return !previous.chatId && !!next.chatId;
}

/** sessionStorage key for tracking in-flight artifact approval/rejection operations. */
export const ARTIFACT_PROCESSING_KEY = 'artifact-processing';

/** sessionStorage key for chat IDs that need a nudge after a locally-initiated approval/rejection. */
export const NUDGE_PENDING_KEY = 'nudge-pending';

/** sessionStorage key prefix for per-chat context-warning bypass ("don't remind me again this session"). */
export const CB_BYPASS_KEY_PREFIX = 'cb-bypass';
