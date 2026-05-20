import { useCallback, useMemo, useRef } from 'react';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/storage/local-storage';
import { draftKey } from '@/lib/storage/storage-keys';
import type { ChatType } from '../types';

export function useChatDraft(chatType: ChatType, chatId: string | null, projectId?: string) {
    const key = draftKey({ kind: 'chat-input', chatType, chatId: chatId ?? undefined, projectId });
    const keyRef = useRef(key);
    keyRef.current = key;

    // Intake /new pages (no chatId, no projectId) discard stale drafts on mount; within-session
    // drafts still survive ensureChatId because migrateDraft copies them to the new chatId key.
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

    return { draftKey: key, initialDraft, saveDraft, clearDraft } as const;
}
