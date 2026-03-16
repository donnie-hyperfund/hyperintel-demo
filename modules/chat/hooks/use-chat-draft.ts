import { useCallback, useMemo, useRef } from 'react';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/storage/local-storage';
import type { ChatType } from '../types';

function draftKey(chatType: ChatType, chatId: string | null, projectId?: string): string | null {
    if (chatId) return `draft:${chatType}:${chatId}`;
    if (projectId) return `draft:${chatType}:${projectId}:new`;
    return `draft:${chatType}:new`;
}

export function useChatDraft(chatType: ChatType, chatId: string | null, projectId?: string) {
    const key = draftKey(chatType, chatId, projectId);
    const keyRef = useRef(key);
    keyRef.current = key;

    const initialDraft = useMemo(() => (key ? (safeGetItem(key) ?? '') : ''), [key]);

    const saveDraft = useCallback((value: string) => {
        const k = keyRef.current;
        if (!k) return;
        if (value.trim()) {
            safeSetItem(k, value);
        } else {
            safeRemoveItem(k);
        }
    }, []);

    const clearDraft = useCallback(() => {
        const k = keyRef.current;
        if (k) safeRemoveItem(k);
    }, []);

    return { initialDraft, saveDraft, clearDraft } as const;
}
