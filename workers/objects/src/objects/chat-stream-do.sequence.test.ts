import { MockDurableObjectId, MockDurableObjectState } from '@common/common/local.do-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEventMessage, StreamStatusMessage } from '@/lib/schema/ws-protocol';
import { ChatStreamDO } from './chat-stream-do';

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

async function createStreamDO(captured: CapturedPush[], idName = 'agent-1', deadManCleanup = vi.fn(async () => {})) {
    const ctx = new MockDurableObjectState(new MockDurableObjectId(idName));
    const writeDataPoint = vi.fn();
    const stream = new ChatStreamDO(
        ctx as unknown as DurableObjectState,
        createEnv(captured, deadManCleanup, writeDataPoint),
    );
    return { ctx, stream, writeDataPoint };
}

async function copyStorage(from: MockDurableObjectState, to: MockDurableObjectState) {
    const entries = await from.storage.list();
    for (const [key, value] of entries) {
        await to.storage.put(key, value);
    }
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
        const second = await createStreamDO(secondCaptured);
        await copyStorage(first.ctx, second.ctx);

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
        const second = await createStreamDO(secondCaptured);
        await copyStorage(first.ctx, second.ctx);

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
        const second = await createStreamDO(secondCaptured);
        await copyStorage(first.ctx, second.ctx);

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

        const result = await stream.subscribe('user-2', 'ug-2');
        expect(result.seqHigh).toBe(1);
        expect(result.snapshot.status).toBe('streaming');
    });

    it('returns seqHigh -1 from subscribe when no broadcasts have happened yet', async () => {
        const captured: CapturedPush[] = [];
        const { stream } = await createStreamDO(captured);
        await stream.init('chat-1', 'agent-1', 'user-msg-1');

        const result = await stream.subscribe('user-1', 'ug-1');
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

    /**
     * Regression: error cleanup must deliver terminal events to subscribers.
     *
     * Encodes the `cleanupStreamDO` ordering (push(error,done) → done() → finalize())
     * and asserts the subscriber received both the error stream_event and the done
     * stream_status. The mock does not simulate CF input gates, so this test alone
     * doesn't reproduce the runtime race — its structural guarantee is "if anything
     * future change re-introduces an await in `sendBatchToSubscribers` before the
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
