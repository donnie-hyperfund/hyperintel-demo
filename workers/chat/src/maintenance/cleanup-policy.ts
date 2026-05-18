export const STALE_CLEANUP_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const STALE_CLEANUP_BATCH_SIZE = 100;

export function createStaleCleanupCutoff(now = Date.now()): Date {
    return new Date(now - STALE_CLEANUP_THRESHOLD_MS);
}
