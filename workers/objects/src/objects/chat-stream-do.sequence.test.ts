import { MockDurableObjectId, MockDurableObjectState, MockDurableObjectStorage } from '@common/common/local.do-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEventMessage, StreamStatusMessage } from '@/lib/schema/ws-protocol';
import { ChatStreamDO, type StreamSubscribeResult } from './chat-stream-do';

type CapturedPush = {
    topic: string;
    messages: unknown[];
};

function createEnv(
    captured: CapturedPush[],
    deadManCleanup = vi.fn(async () => {}),
    writeDataPoint = vi.fn(),
): ObjectsEnv {
    return {
        USER_GATEWAY: {
            idFromName: (name: string) => ({ toString: () => name }),
            get: () => ({
                pushMessages: async (topic: string, messages: unknown[]) => {
                    captured.push({ topic, messages });
                },
            }),
        },
        STREAM_AE: {
            writeDataPoint,
        },
        CHAT_SERVICES: {
            deadManCleanup,
        },
    } as unknown as ObjectsEnv;
}

async function createStreamDO(
    captured: CapturedPush[],
    idName = 'agent-1',
    deadManCleanup = vi.fn(async () => {}),
    storage?: MockDurableObjectStorage,
) {
    const ctx = new MockDurableObjectState(new MockDurableObjectId(idName), storage);
    const writeDataPoint = vi.fn();
    const stream = new ChatStreamDO(
        ctx as unknown as DurableObjectState,
        createEnv(captured, deadManCleanup, writeDataPoint),
    );
    return { ctx, stream, writeDataPoint };
}

async function initAndSubscribe(stream: ChatStreamDO) {
    await stream.init('chat-1', 'agent-1', 'user-msg-1');
    await stream.subscribe('user-1', 'ug-1');
}

async function waitForCapturedMessages(captured: CapturedPush[], count: number) {
    await vi.waitFor(() => {
        const total = captured.reduce((sum, push) => sum + push.messages.length, 0);
        expect(total).toBeGreaterThanOrEqual(count);
    });
    return captured.flatMap((push) => push.messages) as Array<StreamEventMessage | StreamStatusMessage>;
}

function expectStreaming(result: StreamSubscribeResult) {
    expect(result.stale).toBeUndefined();
    if (result.stale) throw new Error('unreachable');
    return result;
}

describe('ChatStreamDO sequence contract', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it('tags pushed event batches with contiguous per-stream _seq values', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        await stream.push([{ type: 'delta', text: ' world' }], 1);

        const messages = await waitForCapturedMessages(captured, 2);
        expect(messages.map((message) => message._seq)).toEqual([0, 1]);
        expect(messages.map((message) => message.type)).toEqual(['stream_event', 'stream_event']);
    });

    it('reloads persisted broadcastSeq so post-reload messages do not reuse _seq values', async () => {
        const firstCaptured: CapturedPush[] = [];
        const first = await createStreamDO(firstCaptured);
        await initAndSubscribe(first.stream);

        await first.stream.push([{ type: 'delta', text: 'before reload' }], 0);
        const firstMessages = await waitForCapturedMessages(firstCaptured, 1);
        expect(firstMessages[0]._seq).toBe(0);

        const secondCaptured: CapturedPush[] = [];
        const second = await createStreamDO(
            secondCaptured,
            'agent-1',
            vi.fn(async () => {}),
            first.ctx.storage,
        );

        await second.stream.push([{ type: 'delta', text: 'after reload' }], 0);
        const secondMessages = await waitForCapturedMessages(secondCaptured, 1);
        expect(secondMessages[0]._seq).toBe(1);
    });

    it('persists broadcastSeq after a status broadcast before reload', async () => {
        const firstCaptured: CapturedPush[] = [];
        const first = await createStreamDO(firstCaptured);
        await initAndSubscribe(first.stream);

        await first.stream.setPendingApproval('tool-1', 'test_tool', {});
        const firstMessages = await waitForCapturedMessages(firstCaptured, 1);
        expect(firstMessages[0]._seq).toBe(0);
        expect(firstMessages[0].type).toBe('stream_status');

        const secondCaptured: CapturedPush[] = [];
        const second = await createStreamDO(
            secondCaptured,
            'agent-1',
            vi.fn(async () => {}),
            first.ctx.storage,
        );

        await second.stream.push([{ type: 'delta', text: 'after reload' }], 0);
        const secondMessages = await waitForCapturedMessages(secondCaptured, 1);
        expect(secondMessages[0]._seq).toBe(1);
    });

    it('persists broadcastSeq after a decision_resolved broadcast before reload', async () => {
        const firstCaptured: CapturedPush[] = [];
        const first = await createStreamDO(firstCaptured);
        await initAndSubscribe(first.stream);

        await first.stream.push(
            [
                {
                    type: 'decision_prompt',
                    toolCallId: 'decision-1',
                    question: 'Choose',
                    options: [{ value: 'yes', label: 'Yes' }],
                },
            ],
            0,
        );
        await first.stream.decisionSelect('decision-1', 'yes');
        const firstMessages = await waitForCapturedMessages(firstCaptured, 2);
        expect(firstMessages.map((message) => message._seq)).toEqual([0, 1]);

        const secondCaptured: CapturedPush[] = [];
        const second = await createStreamDO(
            secondCaptured,
            'agent-1',
            vi.fn(async () => {}),
            first.ctx.storage,
        );

        await second.stream.push([{ type: 'delta', text: 'after reload' }], 0);
        const secondMessages = await waitForCapturedMessages(secondCaptured, 1);
        expect(secondMessages[0]._seq).toBe(2);
    });

    it('returns seqHigh from subscribe using the current broadcast high-water mark', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'first' }], 0);
        await stream.push([{ type: 'delta', text: 'second' }], 1);
        await waitForCapturedMessages(captured, 2);

        const result = expectStreaming(await stream.subscribe('user-2', 'ug-2'));
        expect(result.seqHigh).toBe(1);
        expect(result.snapshot.status).toBe('streaming');
    });

    it('returns seqHigh -1 from subscribe when no broadcasts have happened yet', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        const result = expectStreaming(await stream.subscribe('user-1', 'ug-1'));
        expect(result.seqHigh).toBe(-1);
        expect(result.snapshot.status).toBe('streaming');
    });

    it('emits first-broadcast marker after registration', async () => {
        const captured: CapturedPush[] = [];
        const { stream, writeDataPoint } = await createStreamDO(captured);

        await stream.init('chat-1', 'agent-1', 'user-msg-1', 'chat');
        await stream.subscribe('user-1', 'ug-1');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        await waitForCapturedMessages(captured, 1);

        expect(writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                indexes: ['agent-1'],
                blobs: expect.arrayContaining(['first_broadcast_after_register', 'chat-1', 'chat']),
                doubles: expect.arrayContaining([1, 1]),
            }),
        );
    });

    it('calls services dead-man cleanup on alarm and finalizes', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const captured: CapturedPush[] = [];
        const deadManCleanup = vi.fn(async () => {});
        const { ctx, stream, writeDataPoint } = await createStreamDO(captured, 'agent-1', deadManCleanup);

        await stream.init('chat-1', 'agent-1', 'user-msg-1', 'intake', 'branch-a');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        await stream.alarm();

        expect(deadManCleanup).toHaveBeenCalledWith({
            topic: 'intake:chat-1',
            prefix: 'intake',
            identifier: 'chat-1',
            agentMessageId: 'agent-1',
            previewAlias: 'branch-a',
        });
        expect(writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                indexes: ['agent-1'],
                blobs: expect.arrayContaining(['services_dead_man_cleanup_rpc', 'chat-1', 'branch-a', 'intake']),
                doubles: expect.arrayContaining([1]),
            }),
        );
        await expect(ctx.storage.list()).resolves.toEqual(new Map());
    });

    it('continues finalizing when services dead-man cleanup fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const captured: CapturedPush[] = [];
        const deadManCleanup = vi.fn(async () => {
            throw new Error('services down');
        });
        const { ctx, stream, writeDataPoint } = await createStreamDO(captured, 'agent-1', deadManCleanup);

        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        await stream.alarm();

        expect(consoleError).toHaveBeenCalledWith('ChatStreamDO: DB cleanup failed', expect.any(Error));
        expect(writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                indexes: ['agent-1'],
                blobs: expect.arrayContaining(['services_dead_man_cleanup_rpc', 'chat-1', 'chat']),
                doubles: expect.arrayContaining([0]),
            }),
        );
        await expect(ctx.storage.list()).resolves.toEqual(new Map());
    });

    it('transactionSync rolls back on error — table creation and inserts are atomic', async () => {
        const captured: CapturedPush[] = [];
        const { ctx } = await createStreamDO(captured);

        expect(() =>
            ctx.storage.transactionSync(() => {
                ctx.storage.sql.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
                ctx.storage.sql.exec('INSERT INTO t (id) VALUES (?)', 1);
                ctx.storage.sql.exec('INSERT INTO t (id) VALUES (?)', 1);
            }),
        ).toThrow();

        expect(() => ctx.storage.sql.exec('SELECT * FROM t')).toThrow(/no such table/);
    });

    /**
     * Regression: error cleanup must deliver terminal events to subscribers.
     *
     * Encodes the `cleanupStreamDO` ordering (push(error,done) → done() → finalize())
     * and asserts the subscriber received both the error stream_event and the done
     * stream_status. The mock does not simulate CF input gates, so this test alone
     * doesn't reproduce the runtime race — its structural guarantee is "if a future
     * change re-introduces an await in `sendBatchToSubscribers` before the
     * subscriber loop, the broadcast disappears here too".
     */
    it('delivers terminal events when error cleanup is the first broadcast', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push(
            [
                { type: 'error', error: 'TestError' },
                { type: 'done', error: 'TestError' },
            ],
            0,
        );
        await stream.done();
        await stream.finalize();

        const messages = captured.flatMap((push) => push.messages) as Array<{
            type: string;
            status?: string;
            event?: { type: string };
        }>;
        const doneStatus = messages.find((m) => m.type === 'stream_status' && m.status === 'done');
        expect(doneStatus).toBeDefined();
        const errorEvent = messages.find((m) => m.type === 'stream_event' && m.event?.type === 'error');
        expect(errorEvent).toBeDefined();
    });

    /**
     * Stronger regression: `sendBatchToSubscribers` must not await between the
     * size guard and the subscriber iteration. Asserts the invariant directly so
     * a future await reintroduction breaks the build even where the mock can't
     * reproduce the CF input-gate race.
     */
    it('sendBatchToSubscribers iterates subscribers synchronously after the size guard', () => {
        // `private` is erased at runtime — the prototype carries the implementation.
        const method = (ChatStreamDO.prototype as unknown as Record<string, (...args: unknown[]) => unknown>)
            .sendBatchToSubscribers;
        const src = method.toString();
        const guardIdx = src.indexOf('this.subscribers.size === 0');
        const iterIdx = src.indexOf('for (const');
        expect(guardIdx).toBeGreaterThanOrEqual(0);
        expect(iterIdx).toBeGreaterThan(guardIdx);
        const between = src.slice(guardIdx, iterIdx);
        expect(between).not.toMatch(/\bawait\b/);
    });
});

// ============================================================================
// Reorder buffer (producer seq) — fills, drains in order, recovers from gap.
// ============================================================================

describe('ChatStreamDO reorder buffer (producer seq)', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it('buffers out-of-order pushes and drains contiguously when the gap fills', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        // Arrive: seq 0 (drains), seq 2 (held — waiting for 1), seq 1 (unlocks both)
        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await stream.push([{ type: 'delta', text: 'c' }], 2);
        await stream.push([{ type: 'delta', text: 'b' }], 1);

        const messages = await waitForCapturedMessages(captured, 3);
        // Broadcast _seq is monotonic and reflects drain order, not arrival order.
        expect(messages.map((m) => m._seq)).toEqual([0, 1, 2]);
        const events = messages.map((m) => (m as unknown as { event: { text: string } }).event.text);
        expect(events).toEqual(['a', 'b', 'c']);
    });

    it('ignores duplicate producer seq (seq < nextExpected)', async () => {
        const captured: CapturedPush[] = [];
        const { stream, writeDataPoint } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await waitForCapturedMessages(captured, 1);

        // Re-push seq 0 — should be a no-op (duplicate)
        await stream.push([{ type: 'delta', text: 'dup' }], 0);

        // Still only one broadcast
        const total = captured.reduce((sum, p) => sum + p.messages.length, 0);
        expect(total).toBe(1);
        // Metric confirms the duplicate path was hit
        expect(writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                blobs: expect.arrayContaining(['push_duplicate']),
            }),
        );
    });

    it('skips lost batch after gap timeout — drains remaining batches', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await initAndSubscribe(stream);

        // Seq 0 drains normally
        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await waitForCapturedMessages(captured, 1);

        // Seq 2 arrives but seq 1 is missing — buffered, gap detected
        const baseTime = 1_000_000;
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseTime);
        try {
            await stream.push([{ type: 'delta', text: 'c' }], 2);

            // No new broadcasts yet — seq 2 is held
            const captured2 = captured.flatMap((p) => p.messages);
            expect(captured2).toHaveLength(1);

            // Advance past the 5s timeout and push another batch to trigger the skip path
            nowSpy.mockReturnValue(baseTime + 6_000);
            await stream.push([{ type: 'delta', text: 'd' }], 3);

            // Seqs 2 and 3 drain (1 is permanently lost — producer's responsibility to retry).
            const messages = await waitForCapturedMessages(captured, 3);
            const broadcastSeqs = messages.map((m) => m._seq);
            // Broadcast _seq is monotonic across the writeOutbox boundary.
            expect(broadcastSeqs).toEqual([0, 1, 2]);
            const events = messages.map((m) => (m as unknown as { event: { text: string } }).event.text);
            expect(events).toEqual(['a', 'c', 'd']);
        } finally {
            nowSpy.mockRestore();
        }
    });
});
