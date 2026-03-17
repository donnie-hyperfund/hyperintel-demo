import { useCallback, useMemo, useRef } from 'react';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/storage/local-storage';
import { getDraftBaseKey } from '@/lib/storage/storage-keys';
import type { ChatType } from '../types';

export function useChatDraft(chatType: ChatType, chatId: string | null, projectId?: string) {
    const key = getDraftBaseKey(chatType, chatId, projectId);
    const keyRef = useRef(key);
    keyRef.current = key;

    const initialDraft = useMemo(() => safeGetItem(key) ?? '', [key]);

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
