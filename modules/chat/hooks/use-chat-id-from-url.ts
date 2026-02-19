import { useSyncExternalStore } from 'react';

/**
 * Reads the chatId segment from the URL pathname, staying in sync
 * even after window.history.replaceState (which bypasses Next.js router).
 *
 * Call {@link notifyChatIdChange} after any replaceState to trigger re-renders.
 */

const listeners = new Set<() => void>();

export function notifyChatIdChange() {
    for (const listener of listeners) {
        listener();
    }
}

function subscribe(callback: () => void) {
    listeners.add(callback);
    window.addEventListener('popstate', callback);
    return () => {
        listeners.delete(callback);
        window.removeEventListener('popstate', callback);
    };
}

function getSnapshot(): string | undefined {
    const segments = window.location.pathname.split('/').filter(Boolean);
    // URL: /{projectId}/{chatId}
    return segments.length >= 2 ? segments[1] : undefined;
}

function getServerSnapshot(): string | undefined {
    return undefined;
}

export function useChatIdFromUrl(): string | undefined {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
