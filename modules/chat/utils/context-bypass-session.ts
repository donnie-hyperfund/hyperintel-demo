import { safeGetItem, safeSetItem } from '@/lib/storage/session-storage';
import { CB_BYPASS_KEY_PREFIX } from '@/lib/storage/storage-keys';

const key = (chatId: string) => `${CB_BYPASS_KEY_PREFIX}:${chatId}`;

export function getContextBypassForChat(chatId: string): boolean {
    return safeGetItem(key(chatId)) === 'true';
}

export function setContextBypassForChat(chatId: string): void {
    safeSetItem(key(chatId), 'true');
}
