import { DurableObject } from 'cloudflare:workers';
import type { LockState } from '@/workers/_common/util/locks';

const LOCK_PREFIX = 'lock:';
const MIN_TTL_SECONDS = 10;
const MAX_TTL_SECONDS = 3600;
const MAX_LOCK_ID_LENGTH = 512;
const INACTIVE_LOCK_CLEANUP_MS = 7 * 24 * 60 * 60 * 1000;

function storageKey(lockId: string): string {
    return `${LOCK_PREFIX}${lockId}`;
}

function nowMs(): number {
    return Date.now();
}

function normalizeTtl(ttlSeconds: number): number {
    return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, ttlSeconds ?? MIN_TTL_SECONDS));
}

function isActive(state: LockState | undefined, now = nowMs()): state is LockState {
    return !!state && state.lease > 0 && state.deadline > now;
}

function createLockState(lockId: string, ttlSeconds: number, previous?: LockState): LockState {
    const now = nowMs();
    return {
        lockId,
        lease: (previous?.lease ?? 0) + 1,
        deadline: now + ttlSeconds * 1000,
        lastUsed: now,
    };
}

function refreshLockState(state: LockState, ttlSeconds: number): LockState {
    const now = nowMs();
    return {
        ...state,
        deadline: now + ttlSeconds * 1000,
        lastUsed: now,
    };
}

export class LocksService extends DurableObject<ObjectsEnv> {
    private gate: Promise<void> = Promise.resolve();

    async acquire(lockId: string, ttl: number, leaseNumber: number | null): Promise<LockState | false> {
        return this.runExclusive(() => this.acquireLocked(lockId, ttl, leaseNumber));
    }

    async release(lockId: string, lease: number): Promise<boolean> {
        return this.runExclusive(() => this.releaseLocked(lockId, lease));
    }

    async alarm() {
        await this.runExclusive(async () => {
            await this.removeExpiredLocks();
            await this.scheduleCleanup();
        });
    }

    private async runExclusive<T>(run: () => Promise<T>): Promise<T> {
        const result = this.gate.then(run, run);
        this.gate = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    private async acquireLocked(lockId: string, ttl: number, leaseNumber: number | null): Promise<LockState | false> {
        if (lockId.length < 1 || lockId.length > MAX_LOCK_ID_LENGTH) throw new Error('Invalid lockId');

        const ttlSeconds = normalizeTtl(ttl);
        const key = storageKey(lockId);
        const existing = await this.ctx.storage.get<LockState>(key);

        if (leaseNumber !== null) {
            if (!isActive(existing) || existing.lease !== leaseNumber) return false;
            const refreshed = refreshLockState(existing, ttlSeconds);
            await this.ctx.storage.put(key, refreshed);
            await this.scheduleCleanup();
            return refreshed;
        }

        if (isActive(existing)) return false;

        const created = createLockState(lockId, ttlSeconds, existing);
        await this.ctx.storage.put(key, created);
        await this.scheduleCleanup();
        return created;
    }

    private async releaseLocked(lockId: string, lease: number): Promise<boolean> {
        const key = storageKey(lockId);
        const existing = await this.ctx.storage.get<LockState>(key);
        if (!existing || existing.lease !== lease) return false;

        await this.ctx.storage.put(key, { ...existing, deadline: 0, lastUsed: nowMs() });
        await this.scheduleCleanup();
        return true;
    }

    private async removeExpiredLocks(): Promise<void> {
        const locks = await this.ctx.storage.list<LockState>({ prefix: LOCK_PREFIX });
        const now = nowMs();
        const staleInactiveKeys: string[] = [];

        for (const [key, state] of locks.entries()) {
            if (state.deadline > 0 && state.deadline <= now) {
                await this.ctx.storage.put(key, { ...state, deadline: 0 });
            }

            if (state.deadline <= 0 && state.lastUsed + INACTIVE_LOCK_CLEANUP_MS <= now) {
                staleInactiveKeys.push(key);
            }
        }

        if (staleInactiveKeys.length > 0) {
            await this.ctx.storage.delete(staleInactiveKeys);
        }
    }

    private async scheduleCleanup(): Promise<void> {
        const locks = await this.ctx.storage.list<LockState>({ prefix: LOCK_PREFIX });
        const now = nowMs();
        const deadlines = [...locks.values()].filter((state) => state.deadline > now).map((state) => state.deadline);

        if (deadlines.length === 0) {
            await this.ctx.storage.deleteAlarm();
            return;
        }

        await this.ctx.storage.setAlarm(Math.min(...deadlines) + 100);
    }
}
