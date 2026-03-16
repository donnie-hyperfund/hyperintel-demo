const STORAGE_PREFIX = 'hyperintel:';

export function safeGetItem(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    } catch {
        return null;
    }
}

export function safeSetItem(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
    } catch {
        // Ignore storage failures (e.g. quota exceeded, restricted browser settings).
    }
}

export function safeRemoveItem(key: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    } catch {
        // Ignore storage failures.
    }
}

export function safeGetJsonItem<T>(key: string): T | null {
    const value = safeGetItem(key);
    if (!value) return null;

    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

export function safeSetJsonItem(key: string, value: unknown): void {
    try {
        safeSetItem(key, JSON.stringify(value));
    } catch {
        // Ignore serialization/storage failures.
    }
}

/** Returns the fully-qualified storage key (with prefix) for use with StorageEvent matching. */
export function storageKey(key: string): string {
    return `${STORAGE_PREFIX}${key}`;
}
