import { useCallback, useMemo, useRef } from 'react';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/storage/local-storage';
import { getDraftBaseKey } from '@/lib/storage/storage-keys';
import type { ChatType } from '../types';

export function useChatDraft(chatType: ChatType, chatId: string | null, projectId?: string) {
    const key = getDraftBaseKey(chatType, chatId, projectId);
    const keyRef = useRef(key);
    keyRef.current = key;

    // NOTE: Intake /new pages (no chatId, no projectId) discard stale drafts on mount
    // so that a page refresh starts clean — matching the fact that file uploads also
    // don't persist for these pages (no storage key without a chatId).
    // Within-session draft survives ensureChatId because migrateDraft (chat-provider)
    // copies the draft to the new chatId-scoped key before the remount reads it.
    // TODO: if file upload persistence is added for intake /new, revisit this clearing.
    const isNewIntakeChat = !chatId && !projectId;

    const initialDraft = useMemo(() => {
        if (isNewIntakeChat) {
            safeRemoveItem(key);
            return '';
        }
        return safeGetItem(key) ?? '';
    }, [key, isNewIntakeChat]);

    const saveDraft = useCallback((value: string) => {
        if (value.trim()) {
            safeSetItem(keyRef.current, value);
        } else {
            safeRemoveItem(keyRef.current);
        }
    }, []);

    const clearDraft = useCallback(() => {
        safeRemoveItem(keyRef.current);
    }, []);

    return { initialDraft, saveDraft, clearDraft } as const;
}
