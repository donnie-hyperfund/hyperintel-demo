import { MockDurableObjectId, MockDurableObjectState, MockDurableObjectStorage } from '@common/common/local.do-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatStreamDO, STREAM_STATE_SNAPSHOT } from './chat-stream-do';

type CapturedPush = { topic: string; messages: unknown[] };

function createEnv(captured: CapturedPush[]): ObjectsEnv {
    return {
        USER_GATEWAY: {
            idFromName: (name: string) => ({ toString: () => name }),
            get: () => ({
                pushMessages: async (topic: string, messages: unknown[]) => {
                    captured.push({ topic, messages });
                },
            }),
        },
        STREAM_AE: { writeDataPoint: vi.fn() },
        CHAT_SERVICES: { deadManCleanup: vi.fn(async () => {}) },
    } as unknown as ObjectsEnv;
}

async function createStreamDO(captured: CapturedPush[] = [], idName = 'agent-1', storage?: MockDurableObjectStorage) {
    const ctx = new MockDurableObjectState(new MockDurableObjectId(idName), storage);
    const stream = new ChatStreamDO(ctx as unknown as DurableObjectState, createEnv(captured));
    return { ctx, stream };
}

async function initAndSubscribe(stream: ChatStreamDO) {
    await stream.init('chat-1', 'agent-1', 'user-msg-1');
    await stream.subscribe('user-1', 'ug-1');
}

async function waitForCapturedMessages(captured: CapturedPush[], count: number) {
    await vi.waitFor(() => {
        const total = captured.reduce((sum, p) => sum + p.messages.length, 0);
        expect(total).toBeGreaterThanOrEqual(count);
    });
    return captured.flatMap((p) => p.messages) as Array<{ _seq: number; [key: string]: unknown }>;
}

describe('ChatStreamDO outbox', () => {
    beforeEach(() => {
        vi.useRealTimers();
        STREAM_STATE_SNAPSHOT.enabled = false;
    });

    it('persists outbox entries before broadcast — readOutbox returns them', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        await waitForCapturedMessages(captured, 1);

        const entries = await stream.readOutbox(0, 0);
        expect(entries).toHaveLength(1);
        expect((entries[0] as { _seq: number })._seq).toBe(0);
    });

    it('outbox survives reload — readOutbox returns persisted entries', async () => {
        const captured: CapturedPush[] = [];
        const { ctx, stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await stream.push([{ type: 'delta', text: 'b' }], 1);
        await waitForCapturedMessages(captured, 2);

        // Simulate reload: new DO instance sharing the same storage
        const reloadedCaptured: CapturedPush[] = [];
        const { stream: reloaded } = await createStreamDO(reloadedCaptured, 'agent-1', ctx.storage);

        const tail = await reloaded.readOutbox(0, 1);
        expect(tail).toHaveLength(2);
        expect((tail[0] as { _seq: number })._seq).toBe(0);
        expect((tail[1] as { _seq: number })._seq).toBe(1);
    });

    it('readOutbox returns empty for invalid range', async () => {
        const { stream } = await createStreamDO();
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        const result = await stream.readOutbox(5, 3);
        expect(result).toEqual([]);
    });

    it('ackSeq prunes entries at or below the acked seq', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await stream.push([{ type: 'delta', text: 'b' }], 1);
        await stream.push([{ type: 'delta', text: 'c' }], 2);
        await waitForCapturedMessages(captured, 3);

        await stream.ackSeq(1);

        const remaining = await stream.readOutbox(0, 2);
        expect(remaining).toHaveLength(1);
        expect((remaining[0] as { _seq: number })._seq).toBe(2);
    });

    it('ackSeq throws on future seq beyond broadcastSeq-1', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await waitForCapturedMessages(captured, 1);

        await expect(stream.ackSeq(100)).rejects.toThrow(/exceeds broadcastSeq/);
    });

    it('ackSeq is idempotent — duplicate ack is a no-op', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await waitForCapturedMessages(captured, 1);

        await stream.ackSeq(0);
        await stream.ackSeq(0); // should not throw
    });

    it('outbox cap terminates stream with error status broadcast', async () => {
        const captured: CapturedPush[] = [];
        const { ctx, stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        const bigBatch = Array.from({ length: 2001 }, (_, i) => ({
            type: 'delta' as const,
            text: `msg-${i}`,
        }));

        await expect(stream.push(bigBatch, 0)).rejects.toThrow(/Outbox cap exceeded/);

        const status = await ctx.storage.get('status');
        expect(status).toBe('error');

        // Error status was broadcast to subscribers
        const messages = await waitForCapturedMessages(captured, 1);
        expect(messages.some((m) => (m as unknown as { type: string }).type === 'stream_status')).toBe(true);
    });

    it('cap failure does not burn _seq values — broadcastSeq is rolled back', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        // Push up to just below cap
        const almostFull = Array.from({ length: 1999 }, (_, i) => ({
            type: 'delta' as const,
            text: `fill-${i}`,
        }));
        await stream.push(almostFull, 0);
        await waitForCapturedMessages(captured, 1999);

        // Next push exceeds cap
        const overflowBatch = Array.from({ length: 5 }, (_, i) => ({
            type: 'delta' as const,
            text: `overflow-${i}`,
        }));
        await expect(stream.push(overflowBatch, 1)).rejects.toThrow(/Outbox cap exceeded/);

        // broadcastSeq should still be 1999 (the error message uses seq 1999 but broadcastSeq is rolled back)
        const result = await stream.subscribe('user-2', 'ug-2');
        // seqHigh should reflect only the successfully written entries
        expect(result.seqHigh).toBe(1998);
    });

    it('no broadcast occurs before outbox write — sql.exec failure prevents broadcast', async () => {
        const captured: CapturedPush[] = [];
        const { ctx, stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        // Monkey-patch sql.exec to fail on INSERT
        const originalExec = ctx.storage.sql.exec.bind(ctx.storage.sql);
        let insertCalled = false;
        ctx.storage.sql.exec = ((...args: unknown[]) => {
            const query = args[0] as string;
            if (/^INSERT/i.test(query.trim())) {
                insertCalled = true;
                throw new Error('simulated sql failure');
            }
            return originalExec(...(args as Parameters<typeof originalExec>));
        }) as typeof ctx.storage.sql.exec;

        await expect(stream.push([{ type: 'delta', text: 'x' }], 0)).rejects.toThrow('simulated sql failure');
        expect(insertCalled).toBe(true);

        // No broadcast should have occurred
        const total = captured.reduce((sum, p) => sum + p.messages.length, 0);
        expect(total).toBe(0);
    });

    it('init clears stale outbox entries from a prior lifecycle', async () => {
        const captured: CapturedPush[] = [];
        const { ctx, stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'old' }], 0);
        await waitForCapturedMessages(captured, 1);

        const entriesBefore = await stream.readOutbox(0, 0);
        expect(entriesBefore).toHaveLength(1);

        // Re-init the same DO (simulates reuse without finalize)
        await stream.init('chat-2', 'agent-2', 'user-msg-2');

        const entriesAfter = await stream.readOutbox(0, 0);
        expect(entriesAfter).toHaveLength(0);
        const metaRows = [...ctx.storage.sql.exec('SELECT value FROM outbox_meta WHERE key = ?', 'lastAckedSeq')];
        expect((metaRows[0] as { value: number }).value).toBe(-1);
    });

    it('status broadcasts also write to outbox', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        await stream.done();
        await waitForCapturedMessages(captured, 2);

        const entries = await stream.readOutbox(0, 1);
        expect(entries).toHaveLength(2);
        expect((entries[0] as { _seq: number })._seq).toBe(0);
        expect((entries[1] as { _seq: number; type: string })._seq).toBe(1);
        expect((entries[1] as { type: string }).type).toBe('stream_status');
    });
});
