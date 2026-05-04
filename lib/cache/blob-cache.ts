/**
 * Thin abstraction over the Cache API for storing and retrieving blobs by key.
 * Each cache instance is namespaced to avoid collisions between modules.
 *
 * Features:
 * - TTL-based expiry (default: 7 days)
 * - Max cache size with LRU eviction
 * - Graceful fallback when Cache API is unavailable
 *
 * Usage:
 *   const cache = createBlobCache('artifact-files', { maxSizeBytes: 500 * 1024 * 1024, ttlMs: 7 * 24 * 60 * 60 * 1000 });
 *   await cache.put('file-123', blob, 'application/pdf');
 *   const blob = await cache.get('file-123');
 *   await cache.remove('file-123');
 */

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const METADATA_HEADER = 'X-Cache-Metadata';

type CacheMetadata = {
    storedAt: number;
    size: number;
};

type BlobCacheOptions = {
    /** Time-to-live in milliseconds. Entries older than this are treated as expired. Default: 7 days. */
    ttlMs?: number;
    /** Maximum total cache size in bytes. When exceeded, oldest entries are evicted. No limit by default. */
    maxSizeBytes?: number;
};

function isAvailable(): boolean {
    return typeof caches !== 'undefined';
}

function encodeMetadata(meta: CacheMetadata): string {
    return JSON.stringify(meta);
}

function decodeMetadata(response: Response): CacheMetadata | null {
    const raw = response.headers.get(METADATA_HEADER);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function createBlobCache(namespace: string, options: BlobCacheOptions = {}) {
    const { ttlMs = DEFAULT_TTL_MS, maxSizeBytes } = options;

    async function get(key: string): Promise<Blob | null> {
        if (!isAvailable()) return null;
        try {
            const cache = await caches.open(namespace);
            const response = await cache.match(key);
            if (!response) return null;

            const meta = decodeMetadata(response);
            if (meta && Date.now() - meta.storedAt > ttlMs) {
                await cache.delete(key);
                return null;
            }

            return response.blob();
        } catch {
            return null;
        }
    }

    async function put(key: string, blob: Blob, contentType?: string): Promise<void> {
        if (!isAvailable()) return;
        try {
            const cache = await caches.open(namespace);

            if (maxSizeBytes) {
                await evictIfNeeded(cache, blob.size);
            }

            const meta: CacheMetadata = { storedAt: Date.now(), size: blob.size };
            const headers: HeadersInit = { [METADATA_HEADER]: encodeMetadata(meta) };
            if (contentType) headers['Content-Type'] = contentType;

            await cache.put(key, new Response(blob, { headers }));
        } catch {
            // Quota exceeded or cache unavailable — silently ignore
        }
    }

    async function remove(key: string): Promise<void> {
        if (!isAvailable()) return;
        try {
            const cache = await caches.open(namespace);
            await cache.delete(key);
        } catch {
            // Silently ignore
        }
    }

    async function clear(): Promise<void> {
        if (!isAvailable()) return;
        try {
            await caches.delete(namespace);
        } catch {
            // Silently ignore
        }
    }

    async function evictIfNeeded(cache: Cache, incomingSize: number): Promise<void> {
        const keys = await cache.keys();
        const entries: { key: string; storedAt: number; size: number }[] = [];

        for (const request of keys) {
            const response = await cache.match(request);
            if (!response) continue;
            const meta = decodeMetadata(response);
            entries.push({
                key: request.url,
                storedAt: meta?.storedAt ?? 0,
                size: meta?.size ?? 0,
            });
        }

        // Also evict expired entries
        const now = Date.now();
        for (const entry of entries) {
            if (now - entry.storedAt > ttlMs) {
                await cache.delete(entry.key);
            }
        }

        // Recalculate after TTL eviction
        const remaining = entries.filter((e) => now - e.storedAt <= ttlMs);
        let totalSize = remaining.reduce((sum, e) => sum + e.size, 0);

        if (totalSize + incomingSize <= maxSizeBytes!) return;

        // Evict oldest first until there's room
        remaining.sort((a, b) => a.storedAt - b.storedAt);
        for (const entry of remaining) {
            if (totalSize + incomingSize <= maxSizeBytes!) break;
            await cache.delete(entry.key);
            totalSize -= entry.size;
        }
    }

    return { get, put, remove, clear };
}

export type BlobCache = ReturnType<typeof createBlobCache>;
