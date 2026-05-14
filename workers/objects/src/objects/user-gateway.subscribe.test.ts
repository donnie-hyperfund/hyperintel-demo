/**
 * UserGateway subscribe-ordering integration tests for Stage 1 (Tasks 1.1 + 1.2 + 1.4).
 *
 * Race we are closing: a broadcast to a topic that arrives between
 * `handler.canSubscribe()` resolving and `handler.subscribe()` returning must
 * still reach the socket. The Stage 1 fix is to mark the socket subscribed
 * (`addTopicToSocket`) *before* awaiting `handler.subscribe()`.
 *
 * To prove the race is actually closed (not just that the happy path works) we
 * use a deferred-resolution handler: `subscribe()` returns a promise we hold
 * open while we fire `pushMessage` at the UG. If the old ordering were still in
 * place, the broadcast would silently drop because the socket's
 * `subscribedTopics` is empty until after `handler.subscribe()` resolves.
 */
import { MockCFWebSocket, MockDurableObjectId, MockDurableObjectState } from '@common/common/local.do-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientAction, ServerMsg } from '@/lib/schema/ws-protocol';
import { UserGateway } from './user-gateway';
import type { ActionResult, SubscribeResponse, TopicHandler } from './topic-handler';

// ---------------------------------------------------------------------------
// Test handler — fully controllable from the test
// ---------------------------------------------------------------------------

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (err: unknown) => void;
};

function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

type ControlledHandler = TopicHandler & {
    pendingSubscribes: Deferred<SubscribeResponse>[];
    canSubscribeReturn: boolean;
    canSubscribeCalls: number;
    subscribeCalls: number;
    actionCalls: Array<{ action: string; payload: unknown }>;
};

function createControlledHandler(): ControlledHandler {
    const handler: ControlledHandler = {
        pendingSubscribes: [],
        canSubscribeReturn: true,
        canSubscribeCalls: 0,
        subscribeCalls: 0,
        actionCalls: [],
        async canSubscribe() {
            handler.canSubscribeCalls += 1;
            return handler.canSubscribeReturn ? { allowed: true, subscribeInfo: undefined } : { allowed: false };
        },
        subscribe() {
            handler.subscribeCalls += 1;
            const d = defer<SubscribeResponse>();
            handler.pendingSubscribes.push(d);
            return d.promise;
        },
        unsubscribe() {},
        async handleAction(_userId, action, payload): Promise<ActionResult | void> {
            handler.actionCalls.push({ action, payload });
        },
    };
    return handler;
}

// ---------------------------------------------------------------------------
// Capturing raw WebSocket — records every JSON message sent to the client side
// ---------------------------------------------------------------------------

type CapturedRaw = {
    sends: string[];
    closed: { code?: number; reason?: string } | null;
    readyState: number;
};

function createCapturedSocket(): { raw: CapturedRaw; ws: MockCFWebSocket } {
    const raw: CapturedRaw = { sends: [], closed: null, readyState: 1 };
    const ws = new MockCFWebSocket({
        send: (data: string) => {
            raw.sends.push(data);
        },
        close: (code?: number, reason?: string) => {
            raw.closed = { code, reason };
            raw.readyState = 3;
        },
        get readyState() {
            return raw.readyState;
        },
    });
    return { raw, ws };
}

function parseSends(raw: CapturedRaw): Record<string, unknown>[] {
    return raw.sends.map((s) => JSON.parse(s) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// UG harness
// ---------------------------------------------------------------------------

function createEnv(): ObjectsEnv {
    return {
        STREAM_AE: { writeDataPoint: vi.fn() },
        // Stub Clerk + DB-backed bindings — these tests never exercise auth or DB.
        CLERK_SECRET_KEY: { get: async () => 'sk_test' },
        CLERK_PUBLISHABLE_KEY: 'pk_test',
    } as unknown as ObjectsEnv;
}

function setupAttachedSocket(
    ctx: MockDurableObjectState,
    userId = 'user-1',
): { raw: CapturedRaw; ws: MockCFWebSocket } {
    const { raw, ws } = createCapturedSocket();
    ws.serializeAttachment({
        userId,
        subscribedTopics: [],
        sessionExpiry: undefined,
    });
    ctx.acceptWebSocket(ws, [crypto.randomUUID()]);
    return { raw, ws };
}

function makeUG(): {
    ug: UserGateway;
    ctx: MockDurableObjectState;
    handler: ControlledHandler;
} {
    const ctx = new MockDurableObjectState(new MockDurableObjectId('user-1'));
    const ug = new UserGateway(ctx as unknown as DurableObjectState, createEnv());
    const handler = createControlledHandler();
    // Replace the default handlers — `test:` prefix routes to our controlled handler.
    ug.registerHandler('test', handler);
    return { ug, ctx, handler };
}

async function sendClient(ug: UserGateway, ws: MockCFWebSocket, payload: object): Promise<void> {
    await ug.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(payload));
}

// Wait for the next microtask drain so deferred-resolution promises wire through.
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserGateway subscribe ordering (Stage 1)', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('delivers a broadcast that arrives between addTopic and handler.subscribe resolution', async () => {
        // Deterministic interleave: we hold handler.subscribe() open, fire a
        // push, then resolve. The Stage 1 ordering guarantees the broadcast
        // reaches the socket because addTopicToSocket already ran.
        //
        // PRE-STAGE-1 BEHAVIOR (what this asserts is fixed):
        //   subscribe flow used to be `await handler.subscribe()` BEFORE
        //   `addTopicToSocket`. With that ordering, the broadcast that fires
        //   during the await would see `subscribedTopics: []` and drop.
        //
        // The test therefore fails against the pre-1.1 code: `delivered`
        // would be `undefined` because the broadcast was filtered out.
        const { ug, ctx, handler } = makeUG();
        const { raw, ws } = setupAttachedSocket(ctx);

        // Kick off subscribe — do NOT await; we want it pending.
        const subscribeRpc = sendClient(ug, ws, {
            action: ClientAction.Subscribe,
            topic: 'test:abc',
        });

        // Wait for canSubscribe to clear and handler.subscribe to be invoked.
        await vi.waitFor(() => {
            expect(handler.subscribeCalls).toBe(1);
        });

        // Sanity: SubscribeResponse hasn't gone out yet — subscribe is still pending.
        expect(raw.sends.length).toBe(0);

        // Stage 1 invariant: the socket must already be marked subscribed,
        // so the broadcast we're about to fire will be delivered.
        await ug.pushMessage('test:abc', {
            topic: 'test:abc',
            type: ServerMsg.StreamEvent,
            agentMessageId: 'agent-1',
            event: { type: 'delta', text: 'hi' },
            _seq: 0,
        });

        // Now resolve handler.subscribe and let the response land.
        handler.pendingSubscribes[0].resolve({ status: 'idle' });
        await subscribeRpc;
        await flushMicrotasks();

        const sends = parseSends(raw);
        const broadcast = sends.find((m) => m.type === ServerMsg.StreamEvent);
        const response = sends.find((m) => m.type === ServerMsg.SubscribeResponse);

        // The broadcast MUST be present — this is the bug the reorder closes.
        expect(broadcast).toBeDefined();
        expect(broadcast).toMatchObject({
            topic: 'test:abc',
            type: ServerMsg.StreamEvent,
            event: { type: 'delta', text: 'hi' },
            _seq: 0,
        });
        // SubscribeResponse must also be sent — happy path still holds.
        expect(response).toBeDefined();
        expect(response).toMatchObject({ topic: 'test:abc', status: 'idle' });

        // Ordering on the wire: broadcast was sent BEFORE the SubscribeResponse
        // (it fired while subscribe was still pending). Asserting this
        // catches a regression where the fix swaps directions and accidentally
        // queues the broadcast after the response.
        const broadcastIdx = raw.sends.findIndex((s) => s.includes(ServerMsg.StreamEvent));
        const responseIdx = raw.sends.findIndex((s) => s.includes(ServerMsg.SubscribeResponse));
        expect(broadcastIdx).toBeLessThan(responseIdx);
    });

    it('does not mark the socket on permission failure', async () => {
        const { ug, ctx, handler } = makeUG();
        const { raw, ws } = setupAttachedSocket(ctx);
        handler.canSubscribeReturn = false;

        await sendClient(ug, ws, { action: ClientAction.Subscribe, topic: 'test:abc' });

        expect(handler.subscribeCalls).toBe(0);

        // A broadcast fired after the rejection MUST NOT reach the socket.
        await ug.pushMessage('test:abc', {
            topic: 'test:abc',
            type: ServerMsg.StreamEvent,
            agentMessageId: 'agent-1',
            event: { type: 'delta', text: 'should-not-arrive' },
            _seq: 0,
        });

        const sends = parseSends(raw);
        expect(sends.find((m) => m.type === ServerMsg.StreamEvent)).toBeUndefined();
        const err = sends.find((m) => m.type === ServerMsg.Error);
        expect(err).toMatchObject({ error: 'Forbidden', action: ClientAction.Subscribe });

        // Attachment must NOT carry the topic.
        const attachment = ws.deserializeAttachment() as { subscribedTopics: string[] };
        expect(attachment.subscribedTopics).not.toContain('test:abc');
    });

    it('rolls back the socket attachment when handler.subscribe throws', async () => {
        const { ug, ctx, handler } = makeUG();
        const { raw, ws } = setupAttachedSocket(ctx);

        // Override subscribe to throw immediately.
        (handler as TopicHandler).subscribe = async () => {
            handler.subscribeCalls += 1;
            throw new Error('boom');
        };

        await sendClient(ug, ws, { action: ClientAction.Subscribe, topic: 'test:abc' });

        // Rollback: subscribedTopics is empty so subsequent broadcasts don't reach.
        const attachment = ws.deserializeAttachment() as { subscribedTopics: string[] };
        expect(attachment.subscribedTopics).not.toContain('test:abc');

        await ug.pushMessage('test:abc', {
            topic: 'test:abc',
            type: ServerMsg.StreamEvent,
            agentMessageId: 'agent-1',
            event: { type: 'delta', text: 'nope' },
            _seq: 0,
        });

        const sends = parseSends(raw);
        expect(sends.find((m) => m.type === ServerMsg.StreamEvent)).toBeUndefined();
        // The thrown error path emits a generic error message.
        const err = sends.find((m) => m.type === ServerMsg.Error);
        expect(err).toBeDefined();
    });

    it('handles two overlapping Subscribe requests idempotently (double-Subscribe regression)', async () => {
        // FE may force-send a Subscribe while `resubscribeAll` also fires
        // (SharedWebsocketClient first-connect + ref-count gating). Server
        // subscribe must remain safe under that overlap — the FE drops the
        // second response via subscribePendingRef, but the SERVER must not
        // corrupt the socket's `subscribedTopics` array (e.g., add the topic
        // twice) and must answer both with the same shape.
        const { ug, ctx, handler } = makeUG();
        const { raw, ws } = setupAttachedSocket(ctx);

        const first = sendClient(ug, ws, { action: ClientAction.Subscribe, topic: 'test:abc' });
        await vi.waitFor(() => expect(handler.subscribeCalls).toBe(1));

        const second = sendClient(ug, ws, { action: ClientAction.Subscribe, topic: 'test:abc' });
        await vi.waitFor(() => expect(handler.subscribeCalls).toBe(2));

        handler.pendingSubscribes[0].resolve({ status: 'idle' });
        handler.pendingSubscribes[1].resolve({ status: 'idle' });
        await Promise.all([first, second]);
        await flushMicrotasks();

        const responses = parseSends(raw).filter((m) => m.type === ServerMsg.SubscribeResponse);
        expect(responses).toHaveLength(2);

        // Attachment carries the topic exactly once — `addTopicToSocket` is
        // de-duped by `if (!includes)`.
        const attachment = ws.deserializeAttachment() as { subscribedTopics: string[] };
        const occurrences = attachment.subscribedTopics.filter((t) => t === 'test:abc').length;
        expect(occurrences).toBe(1);

        // A subsequent broadcast still reaches the socket exactly once
        // (no double-fanout because the topic appears once in the attachment).
        raw.sends.length = 0;
        await ug.pushMessage('test:abc', {
            topic: 'test:abc',
            type: ServerMsg.StreamEvent,
            agentMessageId: 'agent-1',
            event: { type: 'delta', text: 'after-double' },
            _seq: 0,
        });
        const broadcasts = parseSends(raw).filter((m) => m.type === ServerMsg.StreamEvent);
        expect(broadcasts).toHaveLength(1);
    });
});
