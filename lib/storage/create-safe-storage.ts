const STORAGE_PREFIX = 'hyperintel:';

export function createSafeStorage(getStorage: () => Storage) {
    function safeGetItem(key: string): string | null {
        if (typeof window === 'undefined') return null;
        try {
            return getStorage().getItem(`${STORAGE_PREFIX}${key}`);
        } catch {
            return null;
        }
    }

    function safeSetItem(key: string, value: string): void {
        if (typeof window === 'undefined') return;
        try {
            getStorage().setItem(`${STORAGE_PREFIX}${key}`, value);
        } catch {
            // Ignore storage failures (e.g. quota exceeded, restricted browser settings).
        }
    }

    function safeRemoveItem(key: string): void {
        if (typeof window === 'undefined') return;
        try {
            getStorage().removeItem(`${STORAGE_PREFIX}${key}`);
        } catch {
            // Ignore storage failures.
        }
    }

    function safeGetJsonItem<T>(key: string): T | null {
        const value = safeGetItem(key);
        if (!value) return null;

        try {
            return JSON.parse(value) as T;
        } catch {
            return null;
        }
    }

    function safeSetJsonItem(key: string, value: unknown): void {
        try {
            safeSetItem(key, JSON.stringify(value));
        } catch {
            // Ignore serialization/storage failures.
        }
    }

    function storageKey(key: string): string {
        return `${STORAGE_PREFIX}${key}`;
    }

    return { safeGetItem, safeSetItem, safeRemoveItem, safeGetJsonItem, safeSetJsonItem, storageKey };
}
