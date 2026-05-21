import { MockDurableObjectId, MockDurableObjectState, MockDurableObjectStorage } from '@common/common/local.do-mock';
import type { StreamSnapshot } from '@/lib/schema/stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type StreamSubscribeResult, ChatStreamDO, STREAM_STATE_SNAPSHOT } from './chat-stream-do';

function expectStreaming(result: StreamSubscribeResult) {
    expect(result.stale).toBeUndefined();
    if (result.stale) throw new Error('unreachable');
    return result;
}

type CapturedPush = { topic: string; messages: unknown[] };
type ApplyCall = { entries: unknown[] };

function createMockStateDO(
    calls: ApplyCall[],
    options?: {
        failUntil?: number;
        resetCalls?: number[];
        resetFailUntil?: number;
        disposeFailUntil?: number;
        getSnapshotResult?: { snapshot: StreamSnapshot; seqHigh: number };
        getSnapshotFailUntil?: number;
    },
) {
    let callCount = 0;
    let resetCallCount = 0;
    let disposeCallCount = 0;
    let getSnapshotCallCount = 0;
    return {
        applyEvents: vi.fn(async (entries: unknown[]) => {
            callCount++;
            calls.push({ entries });
            if (options?.failUntil && callCount <= options.failUntil) {
                throw new Error('state DO unavailable');
            }
            const maxSeq = Math.max(...(entries as Array<{ _seq: number }>).map((e) => e._seq));
            return { ackSeqHigh: maxSeq };
        }),
        reset: vi.fn(async () => {
            resetCallCount++;
            if (options?.resetCalls) options.resetCalls.push(resetCallCount);
            if (options?.resetFailUntil && resetCallCount <= options.resetFailUntil) {
                throw new Error('state DO reset unavailable');
            }
        }),
        dispose: vi.fn(async () => {
            disposeCallCount++;
            if (options?.disposeFailUntil && disposeCallCount <= options.disposeFailUntil) {
                throw new Error('state DO dispose unavailable');
            }
        }),
        getSnapshot: vi.fn(async () => {
            getSnapshotCallCount++;
            if (options?.getSnapshotFailUntil && getSnapshotCallCount <= options.getSnapshotFailUntil) {
                throw new Error('state DO getSnapshot unavailable');
            }
            return (
                options?.getSnapshotResult ?? {
                    snapshot: {
                        blocks: [],
                        activeDocuments: [],
                        pendingDecisions: [],
                        status: 'streaming' as const,
                        displayStatus: null,
                    },
                    seqHigh: -1,
                }
            );
        }),
    };
}

function createEnv(captured: CapturedPush[], stateDOStub: ReturnType<typeof createMockStateDO>): ObjectsEnv {
    return {
        USER_GATEWAY: {
            idFromName: (name: string) => ({ toString: () => name }),
            get: () => ({
                pushMessages: async (topic: string, messages: unknown[]) => {
                    captured.push({ topic, messages });
                },
            }),
        },
        CHAT_STREAM_STATE_DO: {
            idFromName: () => ({ toString: () => 'state-do-1' }),
            get: () => stateDOStub,
        },
        STREAM_AE: { writeDataPoint: vi.fn() },
        CHAT_SERVICES: { deadManCleanup: vi.fn(async () => {}) },
    } as unknown as ObjectsEnv;
}

function createStreamDO(
    captured: CapturedPush[],
    stateDOStub: ReturnType<typeof createMockStateDO>,
    storage?: MockDurableObjectStorage,
) {
    const ctx = new MockDurableObjectState(new MockDurableObjectId('agent-1'), storage);
    const env = createEnv(captured, stateDOStub);
    const stream = new ChatStreamDO(ctx as unknown as DurableObjectState, env);
    return { ctx, stream, env };
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

const EMPTY_SNAPSHOT = {
    blocks: [],
    activeDocuments: [],
    pendingDecisions: [],
    status: 'streaming' as const,
    displayStatus: null,
};

describe('ChatStreamDO pending apply chain', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it('init() resets the state DO', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([]);
        const { stream } = createStreamDO(captured, stateDO);

        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        expect(stateDO.reset).toHaveBeenCalledOnce();
    });

    it('forwards outbox entries to state DO on push', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const stateDO = createMockStateDO(applyCalls);
        const { stream } = createStreamDO(captured, stateDO);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        await waitForCapturedMessages(captured, 1);

        // Wait for the chain to settle
        await vi.waitFor(() => {
            expect(applyCalls.length).toBeGreaterThanOrEqual(1);
        });

        const allEntries = applyCalls.flatMap((c) => c.entries) as Array<{ _seq: number }>;
        expect(allEntries.some((e) => e._seq === 0)).toBe(true);
    });

    it('prunes outbox after successful apply', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const stateDO = createMockStateDO(applyCalls);
        const { stream } = createStreamDO(captured, stateDO);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        await waitForCapturedMessages(captured, 1);

        await vi.waitFor(() => {
            expect(applyCalls.length).toBeGreaterThanOrEqual(1);
        });

        // Outbox should be pruned — readOutbox returns empty for acked range
        const entries = await stream.readOutbox(0, 0);
        expect(entries).toHaveLength(0);
    });

    it('enters state-impaired on state DO failure — live broadcast continues', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const stateDO = createMockStateDO(applyCalls, { failUntil: 999 });
        const { stream } = createStreamDO(captured, stateDO);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        const messages = await waitForCapturedMessages(captured, 1);

        // Live broadcast still works
        expect(messages[0]._seq).toBe(0);

        // Chain was attempted but failed — outbox entries are retained
        await vi.waitFor(() => {
            expect(applyCalls.length).toBeGreaterThanOrEqual(1);
        });
        const entries = await stream.readOutbox(0, 0);
        expect(entries).toHaveLength(1);
    });

    it('done() flushes the apply chain', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const stateDO = createMockStateDO(applyCalls);
        const { stream } = createStreamDO(captured, stateDO);
        await initAndSubscribe(stream);

        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        await waitForCapturedMessages(captured, 1);
        await stream.done();

        // After done(), the chain must have flushed
        const allSeqs = applyCalls.flatMap((c) => c.entries).map((e) => (e as { _seq: number })._seq);
        // seq 0 (delta) and seq 1 (done status) should both be applied
        expect(allSeqs).toContain(0);
        expect(allSeqs).toContain(1);
    });

    it('recovers from state-impaired via terminal flush (done)', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        // Fail the first call, succeed after
        const stateDO = createMockStateDO(applyCalls, { failUntil: 1 });
        const { stream } = createStreamDO(captured, stateDO);
        await initAndSubscribe(stream);

        // Push — chain will fail (call #1)
        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await waitForCapturedMessages(captured, 1);

        await vi.waitFor(() => {
            expect(applyCalls.length).toBeGreaterThanOrEqual(1);
        });

        // Outbox still has entries (apply failed, state-impaired)
        let entries = await stream.readOutbox(0, 0);
        expect(entries).toHaveLength(1);

        // done() forces flushApplyChain which bypasses backoff
        // The flush's reconcileOutbox call (#2) succeeds since failUntil: 1
        await stream.done();

        // After recovery, all entries (delta + done status) are applied and pruned
        entries = await stream.readOutbox(0, 10);
        expect(entries).toHaveLength(0);
    });

    it('startup reconcile drains un-acked outbox from prior lifecycle', async () => {
        const captured: CapturedPush[] = [];
        const failingStateDO = createMockStateDO([], { failUntil: 999 });
        const { ctx, stream: first } = createStreamDO(captured, failingStateDO);
        await initAndSubscribe(first);

        // Push events — state DO is down, so outbox accumulates
        await first.push([{ type: 'delta', text: 'a' }], 0);
        await first.push([{ type: 'delta', text: 'b' }], 1);
        await waitForCapturedMessages(captured, 2);

        // Simulate restart: new DO instance with working state DO, same storage
        const reloadCaptured: CapturedPush[] = [];
        const reloadApplyCalls: ApplyCall[] = [];
        const workingStateDO = createMockStateDO(reloadApplyCalls);
        const { stream: second } = createStreamDO(reloadCaptured, workingStateDO, ctx.storage);

        // ensureLoaded triggers reconcile for un-acked entries
        // Force load by calling any public method
        const entries = await second.readOutbox(0, 1);
        expect(entries.length).toBeGreaterThan(0);

        await vi.waitFor(() => {
            expect(reloadApplyCalls.length).toBeGreaterThanOrEqual(1);
        });

        // After reconcile, outbox is pruned
        const remaining = await second.readOutbox(0, 1);
        expect(remaining).toHaveLength(0);
    });

    it('subscribe() triggers non-blocking reconcile', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const stateDO = createMockStateDO(applyCalls);
        const { stream } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        // Push without a subscriber — outbox written but no WS delivery yet
        await stream.push([{ type: 'delta', text: 'buffered' }], 0);

        // Subscribe triggers chainApply as a recovery path
        await stream.subscribe('user-1', 'ug-1');

        await vi.waitFor(() => {
            expect(applyCalls.length).toBeGreaterThanOrEqual(1);
        });

        // Outbox pruned after subscribe-triggered reconcile
        const entries = await stream.readOutbox(0, 0);
        expect(entries).toHaveLength(0);
    });

    it('reset failure is retried before first successful apply', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const resetCalls: number[] = [];
        // Reset fails on first call (init), succeeds on second (reconcile retry via done flush)
        const stateDO = createMockStateDO(applyCalls, { resetCalls, resetFailUntil: 1 });
        const { stream } = createStreamDO(captured, stateDO);

        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        expect(resetCalls).toHaveLength(1);

        await stream.subscribe('user-1', 'ug-1');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);
        await waitForCapturedMessages(captured, 1);

        // done() forces flushApplyChain → reconcileOutbox retries reset then applies
        await stream.done();

        // Reset was retried successfully before apply
        expect(resetCalls.length).toBeGreaterThanOrEqual(2);
        expect(applyCalls.length).toBeGreaterThanOrEqual(1);

        // Outbox is pruned (apply succeeded after reset retry)
        const entries = await stream.readOutbox(0, 10);
        expect(entries).toHaveLength(0);
    });

    describe('state DO dispose on finalize', () => {
        it('finalize() calls state DO dispose', async () => {
            const captured: CapturedPush[] = [];
            const stateDO = createMockStateDO([]);
            const { stream } = createStreamDO(captured, stateDO);
            await initAndSubscribe(stream);

            await stream.done();
            await stream.finalize();

            expect(stateDO.dispose).toHaveBeenCalledOnce();
        });

        it('dispose failure does not break finalize', async () => {
            const captured: CapturedPush[] = [];
            const stateDO = createMockStateDO([], { disposeFailUntil: 999 });
            const { ctx, stream } = createStreamDO(captured, stateDO);
            await initAndSubscribe(stream);

            await stream.push([{ type: 'delta', text: 'hello' }], 0);
            await waitForCapturedMessages(captured, 1);
            await stream.done();
            await stream.finalize();

            // dispose was attempted
            expect(stateDO.dispose).toHaveBeenCalled();

            // Local cleanup still completed — storage is empty
            const stored = await ctx.storage.list();
            expect(stored.size).toBe(0);
        });
    });
});

describe('ChatStreamDO subscribe from state DO (flag-on)', () => {
    beforeEach(() => {
        vi.useRealTimers();
        STREAM_STATE_SNAPSHOT.enabled = true;
    });

    afterEach(() => {
        STREAM_STATE_SNAPSHOT.enabled = false;
    });

    it('returns state DO snapshot with replayStatus ok when caught up', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const snapshotBlocks = [{ id: 'text-1', type: 'text' as const, content: 'hello from state DO' }];
        const stateDO = createMockStateDO(applyCalls, {
            getSnapshotResult: {
                snapshot: { ...EMPTY_SNAPSHOT, blocks: snapshotBlocks },
                seqHigh: 0,
            },
        });
        const { stream } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);

        await vi.waitFor(() => {
            expect(applyCalls.length).toBeGreaterThanOrEqual(1);
        });

        const result = expectStreaming(await stream.subscribe('user-1', 'ug-1'));

        expect(stateDO.getSnapshot).toHaveBeenCalled();
        expect(result.snapshot.blocks).toEqual(snapshotBlocks);
        expect(result.seqHigh).toBe(0);
        expect(result.replayStatus).toBe('ok');
    });

    it('sends outbox tail as normal WS messages when state DO is behind', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotResult: { snapshot: EMPTY_SNAPSHOT, seqHigh: -1 },
        });
        const { stream } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await stream.push([{ type: 'delta', text: 'b' }], 1);

        captured.length = 0;
        const result = expectStreaming(await stream.subscribe('user-1', 'ug-1'));

        expect(result.seqHigh).toBe(-1);
        expect(result.replayStatus).toBe('ok');

        const tailSeqs = captured
            .flatMap((p) => p.messages)
            .map((m: any) => m._seq)
            .sort((a: number, b: number) => a - b);
        expect(tailSeqs).toEqual([0, 1]);
    });

    it('seqHigh reflects snapshot, not outbox target', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotResult: { snapshot: EMPTY_SNAPSHOT, seqHigh: 2 },
        });
        const { stream } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        for (let i = 0; i < 6; i++) {
            await stream.push([{ type: 'delta', text: String(i) }], i);
        }

        captured.length = 0;
        const result = expectStreaming(await stream.subscribe('user-1', 'ug-1'));

        expect(result.seqHigh).toBe(2);
        expect(result.replayStatus).toBe('ok');

        const tailSeqs = captured
            .flatMap((p) => p.messages)
            .map((m: any) => m._seq)
            .sort((a: number, b: number) => a - b);
        expect(tailSeqs).toEqual([3, 4, 5]);
    });

    it('getSnapshot failure returns stale result — does not throw', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotFailUntil: 999,
        });
        const { stream } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);

        const result = await stream.subscribe('user-1', 'ug-1');

        expect(result.stale).toBe(true);
        expect(result.seqHigh).toBe(-1);
    });

    it('empty tail when state DO is fully reconciled', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const stateDO = createMockStateDO(applyCalls, {
            getSnapshotResult: {
                snapshot: { ...EMPTY_SNAPSHOT, blocks: [{ id: 'text-1', type: 'text' as const, content: 'abc' }] },
                seqHigh: 3,
            },
        });
        const { stream } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        for (let i = 0; i < 4; i++) {
            await stream.push([{ type: 'delta', text: String(i) }], i);
        }

        await vi.waitFor(() => {
            expect(applyCalls.length).toBeGreaterThanOrEqual(1);
        });

        captured.length = 0;
        const result = expectStreaming(await stream.subscribe('user-1', 'ug-1'));

        expect(result.seqHigh).toBe(3);
        expect(result.replayStatus).toBe('ok');
        const tailMessages = captured.flatMap((p) => p.messages) as Array<{ _seq: number }>;
        expect(tailMessages).toHaveLength(0);
    });

    it('stateSeqHigh > targetSeqHigh — no tail, seqHigh = stateSeqHigh', async () => {
        const captured: CapturedPush[] = [];
        // State DO reports seqHigh 5 but we only pushed 3 events (seq 0-2).
        // This simulates a race where reconcile completed during the subscribe await.
        const stateDO = createMockStateDO([], {
            getSnapshotResult: { snapshot: EMPTY_SNAPSHOT, seqHigh: 5 },
        });
        const { stream } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        for (let i = 0; i < 3; i++) {
            await stream.push([{ type: 'delta', text: String(i) }], i);
        }

        captured.length = 0;
        const result = expectStreaming(await stream.subscribe('user-1', 'ug-1'));

        expect(result.seqHigh).toBe(5);
        expect(result.replayStatus).toBe('ok');
        const tailMessages = captured.flatMap((p) => p.messages);
        expect(tailMessages).toHaveLength(0);
    });

    it('replay send failure returns state DO snapshot with replayStatus failed', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotResult: {
                snapshot: { ...EMPTY_SNAPSHOT, blocks: [{ id: 'b1', type: 'text' as const, content: 'partial' }] },
                seqHigh: 0,
            },
        });
        const failingEnv = {
            USER_GATEWAY: {
                idFromName: (name: string) => ({ toString: () => name }),
                get: () => ({
                    pushMessages: async () => {
                        throw new Error('UG unavailable');
                    },
                }),
            },
            CHAT_STREAM_STATE_DO: {
                idFromName: () => ({ toString: () => 'state-do-1' }),
                get: () => stateDO,
            },
            STREAM_AE: { writeDataPoint: vi.fn() },
            CHAT_SERVICES: { deadManCleanup: vi.fn(async () => {}) },
        } as unknown as ObjectsEnv;

        const ctx = new MockDurableObjectState(new MockDurableObjectId('agent-1'));
        const stream = new ChatStreamDO(ctx as unknown as DurableObjectState, failingEnv);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await stream.push([{ type: 'delta', text: 'b' }], 1);

        const result = expectStreaming(await stream.subscribe('user-1', 'ug-1'));

        expect(result.snapshot.blocks[0].content).toBe('partial');
        expect(result.seqHigh).toBe(0);
        expect(result.replayStatus).toBe('failed');
    });

    it('replay messages arrive as stream_event/stream_status with correct _seq', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotResult: { snapshot: EMPTY_SNAPSHOT, seqHigh: -1 },
        });
        const { stream } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        await stream.push([{ type: 'delta', text: 'first' }], 0);
        await stream.push([{ type: 'delta', text: 'second' }], 1);

        captured.length = 0;
        const result = expectStreaming(await stream.subscribe('user-1', 'ug-1'));

        const replayMessages = captured.flatMap((p) => p.messages) as Array<{
            _seq: number;
            type: string;
            topic: string;
        }>;

        for (const msg of replayMessages) {
            expect(['stream_event', 'stream_status']).toContain(msg.type);
            expect(msg.topic).toBe(`chat:chat-1`);
        }

        const seqs = replayMessages.map((m) => m._seq).sort((a, b) => a - b);
        expect(seqs).toEqual([0, 1]);
        expect(result.seqHigh).toBe(-1);
    });

    it('replay messages are sent before subscribe() resolves', async () => {
        const timeline: string[] = [];
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotResult: { snapshot: EMPTY_SNAPSHOT, seqHigh: -1 },
        });

        const ctx = new MockDurableObjectState(new MockDurableObjectId('agent-1'));
        const env = {
            USER_GATEWAY: {
                idFromName: (name: string) => ({ toString: () => name }),
                get: () => ({
                    pushMessages: async (_topic: string, _messages: unknown[]) => {
                        timeline.push('replay_sent');
                    },
                }),
            },
            CHAT_STREAM_STATE_DO: {
                idFromName: () => ({ toString: () => 'state-do-1' }),
                get: () => stateDO,
            },
            STREAM_AE: { writeDataPoint: vi.fn() },
            CHAT_SERVICES: { deadManCleanup: vi.fn(async () => {}) },
        } as unknown as ObjectsEnv;

        const stream = new ChatStreamDO(ctx as unknown as DurableObjectState, env);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);

        const result = await stream.subscribe('user-1', 'ug-1');
        timeline.push('subscribe_resolved');

        expect(timeline).toEqual(['replay_sent', 'subscribe_resolved']);
        expect(result.stale).toBeUndefined();
    });
});

// ============================================================================
// TELEMETRY (4.6a) — asserts that metrics are actually emitted
// ============================================================================

function metricsFromEnv(env: ObjectsEnv): Array<{ blobs: string[]; doubles: number[] }> {
    return (env.STREAM_AE.writeDataPoint as ReturnType<typeof vi.fn>).mock.calls.map(
        (args: any[]) => args[0] as { blobs: string[]; doubles: number[] },
    );
}

function findMetric(env: ObjectsEnv, name: string) {
    return metricsFromEnv(env).filter((dp) => dp.blobs[0] === name);
}

describe('ChatStreamDO 4.6a telemetry', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it('emits outbox_write on every push', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([]);
        const { stream, env } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.subscribe('user-1', 'ug-1');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);

        const writes = findMetric(env, 'outbox_write');
        expect(writes.length).toBeGreaterThanOrEqual(1);
        expect(writes[0].doubles[0]).toBeGreaterThanOrEqual(0); // duration_ms
        expect(writes[0].doubles[1]).toBeGreaterThan(0); // entry_bytes
    });

    it('emits reconciler_run on successful reconcile', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const stateDO = createMockStateDO(applyCalls);
        const { stream, env } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);

        await vi.waitFor(() => expect(findMetric(env, 'reconciler_run').length).toBeGreaterThanOrEqual(1));

        const runs = findMetric(env, 'reconciler_run');
        const success = runs.find((dp) => dp.doubles[2] === 1);
        expect(success).toBeDefined();
        expect(success!.doubles[1]).toBe(1); // events_replayed
    });

    it('emits reconciler_run with success=0 on failure', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], { failUntil: 999 });
        const { stream, env } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);

        await vi.waitFor(() => {
            const runs = findMetric(env, 'reconciler_run');
            expect(runs.some((dp) => dp.doubles[2] === 0)).toBe(true);
        });

        const failure = findMetric(env, 'reconciler_run').find((dp) => dp.doubles[2] === 0);
        expect(failure).toBeDefined();
        expect(failure!.doubles[0]).toBeGreaterThanOrEqual(0); // duration_ms
    });

    it('emits state_do_get_snapshot_rpc on subscribe', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotResult: { snapshot: EMPTY_SNAPSHOT, seqHigh: -1 },
        });
        const { stream, env } = createStreamDO(captured, stateDO);
        STREAM_STATE_SNAPSHOT.enabled = true;
        try {
            await stream.init('chat-1', 'agent-1', 'user-msg-1');
            await stream.push([{ type: 'delta', text: 'hello' }], 0);
            await stream.subscribe('user-1', 'ug-1');

            const snapshots = findMetric(env, 'state_do_get_snapshot_rpc');
            expect(snapshots).toHaveLength(1);
            expect(snapshots[0].doubles[0]).toBeGreaterThanOrEqual(0); // duration_ms
            expect(snapshots[0].doubles[1]).toBeGreaterThan(0); // snapshot_bytes
        } finally {
            STREAM_STATE_SNAPSHOT.enabled = false;
        }
    });

    it('emits state_do_apply_rpc around the cross-DO call', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const stateDO = createMockStateDO(applyCalls);
        const { stream, env } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'hello' }], 0);

        await vi.waitFor(() => expect(applyCalls.length).toBeGreaterThanOrEqual(1));

        const rpcs = findMetric(env, 'state_do_apply_rpc');
        expect(rpcs.length).toBeGreaterThanOrEqual(1);
        expect(rpcs[0].doubles[0]).toBeGreaterThanOrEqual(0); // duration_ms
        expect(rpcs[0].doubles[1]).toBe(1); // batch_size
    });

    it('emits terminal_snapshot_parity_check after terminal catch-up', async () => {
        const captured: CapturedPush[] = [];
        const blockId = 'text-terminal';
        const stateDO = createMockStateDO([], {
            getSnapshotResult: {
                snapshot: {
                    ...EMPTY_SNAPSHOT,
                    blocks: [{ id: blockId, type: 'text' as const, content: 'done' }],
                    status: 'done',
                },
                seqHigh: 1,
            },
        });
        const { stream, env } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'done', blockId }], 0);

        await stream.done();

        const parity = findMetric(env, 'terminal_snapshot_parity_check');
        expect(parity).toHaveLength(1);
        expect(parity[0].doubles).toEqual([1, 1, 1]);
        expect(parity[0].blobs).toContain('match');
        expect(parity[0].blobs).toContain('done');
    });

    it('emits terminal_state_catchup_failed instead of parity when state is behind terminal seq', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], {
            getSnapshotResult: { snapshot: EMPTY_SNAPSHOT, seqHigh: 0 },
        });
        const { stream, env } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'done' }], 0);

        await stream.done();

        const catchup = findMetric(env, 'terminal_state_catchup_failed');
        expect(catchup).toHaveLength(1);
        expect(catchup[0].doubles).toEqual([1, 0, 1]);
        expect(catchup[0].blobs).toContain('done');
        expect(findMetric(env, 'terminal_snapshot_parity_check')).toHaveLength(0);
    });
});

// ============================================================================
// Cross-cutting integration scenarios — close the remaining Phase 3 gaps.
// ============================================================================

describe('ChatStreamDO alarm under state DO outage', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it('still broadcasts error and finalizes when state DO is unreachable', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const captured: CapturedPush[] = [];
        // Reset fails on every call, apply fails on every call → state DO completely down.
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            resetFailUntil: 999,
            disposeFailUntil: 999,
        });
        const { ctx, stream } = createStreamDO(captured, stateDO);

        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.subscribe('user-1', 'ug-1');
        // Push a streaming event so status flips to 'streaming' and alarm has work to do.
        await stream.push([{ type: 'delta', text: 'mid-stream' }], 0);
        await waitForCapturedMessages(captured, 1);

        captured.length = 0;
        // Dead-man fires while state DO is unreachable.
        await stream.alarm();

        // Error status reaches subscribers — broadcast path is independent of state DO.
        const messages = captured.flatMap((p) => p.messages) as Array<{ type: string; status?: string }>;
        const errorStatus = messages.find((m) => m.type === 'stream_status' && m.status === 'error');
        expect(errorStatus).toBeDefined();

        // Finalize ran: storage is empty regardless of dispose failure.
        const stored = await ctx.storage.list();
        expect(stored.size).toBe(0);
    });
});

describe('ChatStreamDO subscribe after restart (flag-on)', () => {
    beforeEach(() => {
        vi.useRealTimers();
        STREAM_STATE_SNAPSHOT.enabled = true;
    });

    afterEach(() => {
        STREAM_STATE_SNAPSHOT.enabled = false;
    });

    it('serves snapshot + outbox tail composition correctly after ChatStreamDO restart', async () => {
        // First lifecycle: state DO unreachable, outbox accumulates entries.
        const firstCaptured: CapturedPush[] = [];
        const firstStateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotResult: { snapshot: EMPTY_SNAPSHOT, seqHigh: -1 },
        });
        const { ctx, stream: first } = createStreamDO(firstCaptured, firstStateDO);
        await first.init('chat-1', 'agent-1', 'user-msg-1');
        await first.subscribe('user-1', 'ug-1');
        await first.push([{ type: 'delta', text: 'a' }], 0);
        await first.push([{ type: 'delta', text: 'b' }], 1);
        await waitForCapturedMessages(firstCaptured, 2);

        // Second lifecycle: same storage, fresh in-memory state, state DO now reports its snapshot.
        // Note: ensureLoaded() will trigger 'recovery' chainApply on first RPC.
        const secondCaptured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        const secondStateDO = createMockStateDO(applyCalls, {
            getSnapshotResult: {
                snapshot: { ...EMPTY_SNAPSHOT, blocks: [{ id: 'b1', type: 'text' as const, content: 'ab' }] },
                seqHigh: 1,
            },
        });
        const { stream: second } = createStreamDO(secondCaptured, secondStateDO, ctx.storage);

        const result = expectStreaming(await second.subscribe('user-2', 'ug-2'));

        // Snapshot reflects state DO's view, seqHigh matches reconciled state.
        expect(result.snapshot.blocks[0].content).toBe('ab');
        expect(result.seqHigh).toBe(1);
        expect(result.replayStatus).toBe('ok');
    });
});

describe('ChatStreamDO state-impaired subscribe', () => {
    beforeEach(() => {
        vi.useRealTimers();
        STREAM_STATE_SNAPSHOT.enabled = true;
    });

    afterEach(() => {
        STREAM_STATE_SNAPSHOT.enabled = false;
    });

    it('uses outbox tail to fill gap when state DO is impaired but getSnapshot still responds', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const captured: CapturedPush[] = [];
        // apply fails always (state-impaired), but getSnapshot returns a stale snapshot at seqHigh=0.
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotResult: {
                snapshot: { ...EMPTY_SNAPSHOT, blocks: [{ id: 'b1', type: 'text' as const, content: 'stale' }] },
                seqHigh: 0,
            },
        });
        const { stream } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        // Push 3 events without a subscriber — outbox accumulates, chain fails into state-impaired.
        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await stream.push([{ type: 'delta', text: 'b' }], 1);
        await stream.push([{ type: 'delta', text: 'c' }], 2);

        const result = expectStreaming(await stream.subscribe('user-1', 'ug-1'));

        // Snapshot from impaired state DO, tail from outbox.
        expect(result.snapshot.blocks[0].content).toBe('stale');
        expect(result.seqHigh).toBe(0);
        expect(result.replayStatus).toBe('ok');

        // Outbox tail [1, 2] was sent as WS messages.
        const tailSeqs = captured
            .flatMap((p) => p.messages)
            .map((m: any) => m._seq)
            .sort((a: number, b: number) => a - b);
        expect(tailSeqs).toEqual([1, 2]);
    });
});

describe('ChatStreamDO shadow parity compare (flag-off)', () => {
    beforeEach(() => {
        vi.useRealTimers();
        // Flag is off by default — explicit for clarity.
        STREAM_STATE_SNAPSHOT.enabled = false;
    });

    it('emits snapshot_parity_check with match when local and state DO snapshots agree', async () => {
        const captured: CapturedPush[] = [];
        const applyCalls: ApplyCall[] = [];
        // State DO returns a snapshot equivalent to what local would produce after one delta.
        // The local reducer for `{ type: 'delta', text: 'hi' }` produces:
        //   blocks: [{ id: 'text-<ts>', type: 'text', content: 'hi' }]
        //   status: 'streaming'
        // To match exactly we control the blockId via the event, then echo the same in the mock.
        const fixedBlockId = 'text-fixed';
        const stateDO = createMockStateDO(applyCalls, {
            getSnapshotResult: {
                snapshot: {
                    ...EMPTY_SNAPSHOT,
                    blocks: [{ id: fixedBlockId, type: 'text' as const, content: 'hi' }],
                },
                seqHigh: 0,
            },
        });
        const { stream, env } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'hi', blockId: fixedBlockId }], 0);

        await stream.subscribe('user-1', 'ug-1');

        await vi.waitFor(() => expect(findMetric(env, 'snapshot_parity_check').length).toBeGreaterThanOrEqual(1));
        const parity = findMetric(env, 'snapshot_parity_check')[0];
        expect(parity.doubles[0]).toBe(1); // match
        expect(parity.doubles[1]).toBe(0); // localSeqHigh
        expect(parity.doubles[2]).toBe(0); // stateSeqHigh
        expect(parity.blobs).toContain('match');
    });

    it('emits snapshot_parity_check with divergence blob when snapshots differ', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], {
            getSnapshotResult: {
                snapshot: {
                    ...EMPTY_SNAPSHOT,
                    // State DO has TWO blocks but local has one — mismatch on block_count.
                    blocks: [
                        { id: 'a', type: 'text' as const, content: 'one' },
                        { id: 'b', type: 'text' as const, content: 'two' },
                    ],
                },
                seqHigh: 0,
            },
        });
        const { stream, env } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'hi' }], 0);

        await stream.subscribe('user-1', 'ug-1');

        await vi.waitFor(() => expect(findMetric(env, 'snapshot_parity_check').length).toBeGreaterThanOrEqual(1));
        const parity = findMetric(env, 'snapshot_parity_check')[0];
        expect(parity.doubles[0]).toBe(0); // mismatch
        const divergence = parity.blobs.find((b) => b.startsWith('block_count'));
        expect(divergence).toBeDefined();
    });

    it('emits snapshot_parity_skip when state DO is lagging (seqHigh differs)', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], {
            failUntil: 999, // applies fail, so state DO stays at seqHigh=-1
            getSnapshotResult: { snapshot: EMPTY_SNAPSHOT, seqHigh: -1 },
        });
        const { stream, env } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'ahead' }], 0);

        await stream.subscribe('user-1', 'ug-1');

        await vi.waitFor(() => expect(findMetric(env, 'snapshot_parity_skip').length).toBeGreaterThanOrEqual(1));
        const skip = findMetric(env, 'snapshot_parity_skip')[0];
        expect(skip.doubles[0]).toBe(0); // localSeqHigh
        expect(skip.doubles[1]).toBe(-1); // stateSeqHigh
        expect(skip.blobs).toContain('state_behind');
        // No parity check emitted under lag.
        expect(findMetric(env, 'snapshot_parity_check')).toHaveLength(0);
    });

    it('clones the local snapshot — concurrent push during compare does not corrupt the metric', async () => {
        const captured: CapturedPush[] = [];
        let releaseSnapshot: () => void = () => {};
        const snapshotGate = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });

        // Mock state DO that blocks on getSnapshot until we release the gate.
        // Returns a snapshot that matches the state of the local DO AT THE TIME OF SUBSCRIBE
        // (one block with content 'a'). If the local snapshot is passed by reference, the
        // concurrent push of 'BB' will mutate the captured block before diff runs.
        const fixedBlockId = 'text-fixed';
        const stateDO = {
            applyEvents: vi.fn(async (entries: unknown[]) => {
                const maxSeq = Math.max(...(entries as Array<{ _seq: number }>).map((e) => e._seq));
                return { ackSeqHigh: maxSeq };
            }),
            reset: vi.fn(async () => {}),
            dispose: vi.fn(async () => {}),
            getSnapshot: vi.fn(async () => {
                await snapshotGate;
                return {
                    snapshot: {
                        ...EMPTY_SNAPSHOT,
                        blocks: [{ id: fixedBlockId, type: 'text' as const, content: 'a' }],
                    },
                    seqHigh: 0,
                };
            }),
        };

        const { stream, env } = createStreamDO(captured, stateDO as any);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'a', blockId: fixedBlockId }], 0);

        // Subscribe — kicks off background shadowCompareToStateDO (awaiting on snapshotGate).
        await stream.subscribe('user-1', 'ug-1');

        // While compare is blocked, mutate the local reducer state by pushing into the same block.
        await stream.push([{ type: 'delta', text: 'BB', blockId: fixedBlockId }], 1);

        // Release getSnapshot — diff runs now. With the clone fix, diff compares the
        // captured-at-subscribe snapshot ('a') against the state DO snapshot ('a') → match.
        // Without the clone, local.blocks[0].content would be 'aBB' → divergence.
        releaseSnapshot();

        await vi.waitFor(() => expect(findMetric(env, 'snapshot_parity_check').length).toBeGreaterThanOrEqual(1));
        const parity = findMetric(env, 'snapshot_parity_check')[0];
        expect(parity.doubles[0]).toBe(1); // match
        expect(parity.blobs).toContain('match');
    });

    it('emits no parity metric and does not throw when state DO is unreachable', async () => {
        const captured: CapturedPush[] = [];
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotFailUntil: 999,
        });
        const { stream, env } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');
        await stream.push([{ type: 'delta', text: 'hi' }], 0);

        // Must not throw — shadow compare is fully out-of-band.
        await expect(stream.subscribe('user-1', 'ug-1')).resolves.toBeDefined();

        // Give the background compare a moment to fail silently.
        await new Promise((r) => setTimeout(r, 10));
        expect(findMetric(env, 'snapshot_parity_check')).toHaveLength(0);
        expect(findMetric(env, 'snapshot_parity_skip')).toHaveLength(0);
    });
});

describe('ChatStreamDO outbox tail contiguity check (flag-on)', () => {
    beforeEach(() => {
        vi.useRealTimers();
        STREAM_STATE_SNAPSHOT.enabled = true;
    });

    afterEach(() => {
        STREAM_STATE_SNAPSHOT.enabled = false;
    });

    it('returns replayStatus=failed when ackSeq has pruned entries within the expected tail range', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const captured: CapturedPush[] = [];
        // state DO claims it only got seqHigh=-1, but the outbox has been pruned for seq <= 1
        // because something ACK'd before getSnapshot reported its view.
        const stateDO = createMockStateDO([], {
            failUntil: 999,
            getSnapshotResult: { snapshot: EMPTY_SNAPSHOT, seqHigh: -1 },
        });
        const { stream } = createStreamDO(captured, stateDO);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        await stream.push([{ type: 'delta', text: 'a' }], 0);
        await stream.push([{ type: 'delta', text: 'b' }], 1);
        await stream.push([{ type: 'delta', text: 'c' }], 2);

        // Prune the head of the outbox so the tail [0..2] has a hole at the start.
        await stream.ackSeq(1);

        const result = expectStreaming(await stream.subscribe('user-1', 'ug-1'));

        // tail asked for [0..2] but only [2] exists → contiguity check fails, no replay sent.
        expect(result.replayStatus).toBe('failed');
        expect(result.seqHigh).toBe(-1);
        const sent = captured.flatMap((p) => p.messages);
        expect(sent).toHaveLength(0);
    });
});
