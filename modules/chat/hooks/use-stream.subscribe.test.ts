// @vitest-environment jsdom
/**
 * useStream subscribe-buffer integration tests (Stage 1, Task 1.4).
 *
 * Race we are closing on the FE: live `stream_event` / `stream_status`
 * messages may arrive BEFORE the `SubscribeResponse` snapshot lands
 * (the per-stream `_seq` is assigned at broadcast time and races the
 * snapshot RPC). The Stage 1 fix is a pre-snapshot buffer that holds
 * live messages until the snapshot is applied, then flushes them in
 * `_seq` order with `_seq <= seqHigh` duplicates dropped.
 *
 * To prove the race is actually closed (not just that the happy path
 * works), each test drives the hook by emitting live messages BEFORE
 * the SubscribeResponse. Pre-Stage-1 code drops those events on the
 * `ownedAgentMessageIdRef.current === null` floor. The buffered events
 * here therefore can't reach state via the old code path.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@/lib/schema/ws-protocol';
import { ServerMsg } from '@/lib/schema/ws-protocol';

// ---------------------------------------------------------------------------
// Mocks installed before importing the SUT
// ---------------------------------------------------------------------------

type MessageListener = (msg: ServerMessage & { rid?: string }) => void;
type ConnectedListener = () => void;

const wsState: {
    connected: boolean;
    sends: unknown[];
    messageListeners: MessageListener[];
    connectedListeners: ConnectedListener[];
    subscribeCalls: string[];
} = {
    connected: true,
    sends: [],
    messageListeners: [],
    connectedListeners: [],
    subscribeCalls: [],
};

const wsMock = {
    get connected() {
        return wsState.connected;
    },
    subscribe: (topic: string) => {
        wsState.subscribeCalls.push(topic);
        return () => {};
    },
    send: (msg: unknown) => {
        wsState.sends.push(msg);
    },
    sendAction: () => {},
    on: (event: 'message' | 'connected' | 'disconnected', fn: any) => {
        if (event === 'message') wsState.messageListeners.push(fn);
        else if (event === 'connected') wsState.connectedListeners.push(fn);
    },
    off: (event: 'message' | 'connected' | 'disconnected', fn: any) => {
        if (event === 'message') {
            wsState.messageListeners = wsState.messageListeners.filter((l) => l !== fn);
        } else if (event === 'connected') {
            wsState.connectedListeners = wsState.connectedListeners.filter((l) => l !== fn);
        }
    },
};

vi.mock('@/lib/websocket/provider', () => ({
    useWebsocket: () => wsMock,
}));

const posthogCalls: Array<{ event: string; properties: Record<string, unknown> }> = [];
vi.mock('@/lib/analytics/posthog-browser', () => ({
    capturePostHogEvent: (event: string, properties: Record<string, unknown>) => {
        posthogCalls.push({ event, properties });
    },
}));

// IS_PROD must be false so diagnostics are emitted and console.debug fires.
vi.mock('@/lib/config', () => ({
    IS_PROD: false,
}));

vi.mock('@/modules/artifacts/streaming/artifact-stream-monitor-provider', () => ({
    useArtifactStreamMonitor: () => ({
        register: vi.fn(),
        markSummaryStarted: vi.fn(),
        unregister: vi.fn(),
        takeover: vi.fn(),
        release: vi.fn(),
        isMonitoring: vi.fn(() => false),
        setViewedArtifact: vi.fn(),
        setActivationHandler: vi.fn(),
        tryActivate: vi.fn(() => false),
        subscribe: vi.fn(() => vi.fn()),
        getActiveStreams: vi.fn(() => []),
    }),
}));

// Silence the diagnostic console.debug noise during tests but keep failures visible.
const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

// SUT — imported after mocks
import { useStream } from './use-stream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emit(msg: object) {
    act(() => {
        for (const fn of wsState.messageListeners) fn(msg as any);
    });
}

const TOPIC = 'chat:chat-1';

function streamEvent(agentMessageId: string, seq: number, event: object) {
    return {
        topic: TOPIC,
        type: ServerMsg.StreamEvent,
        agentMessageId,
        _seq: seq,
        event,
    };
}

function streamStatus(agentMessageId: string, seq: number, status: string) {
    return {
        topic: TOPIC,
        type: ServerMsg.StreamStatus,
        agentMessageId,
        _seq: seq,
        status,
    };
}

function subscribeResponse(opts: {
    status: 'streaming' | 'idle';
    agentMessageId?: string;
    seqHigh?: number;
    snapshotStatus?: 'streaming';
}) {
    if (opts.status === 'idle') {
        return { topic: TOPIC, type: ServerMsg.SubscribeResponse, status: 'idle' };
    }
    return {
        topic: TOPIC,
        type: ServerMsg.SubscribeResponse,
        status: 'streaming',
        agentMessageId: opts.agentMessageId!,
        seqHigh: opts.seqHigh!,
        snapshot: {
            blocks: [],
            activeDocuments: [],
            pendingDecisions: [],
            status: opts.snapshotStatus ?? 'streaming',
            displayStatus: null,
        },
    };
}

function bufferDiagnosticsFor(topic: string): Record<string, unknown>[] {
    return posthogCalls
        .filter((c) => c.event === 'stream_subscribe_buffer_flushed' && c.properties.topic_id === topic.split(':')[1])
        .map((c) => c.properties);
}

// Some tests rely on the SubscribeResponse handler running synchronously
// inside the emit() act() — no rAF involved, so state is observable immediately.

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useStream subscribe buffer (Stage 1)', () => {
    beforeEach(() => {
        wsState.connected = true;
        wsState.sends.length = 0;
        wsState.messageListeners.length = 0;
        wsState.connectedListeners.length = 0;
        wsState.subscribeCalls.length = 0;
        posthogCalls.length = 0;
    });
    afterEach(() => {
        consoleDebugSpy.mockClear();
    });

    it('buffers live status events that arrive before SubscribeResponse and applies non-duplicates after the snapshot', async () => {
        // Pre-Stage-1 path: at this point `ownedAgentMessageIdRef.current === null`
        // and the StreamStatus handler would early-return. With the buffer, the
        // events are held and replayed once the snapshot lands. The
        // `pending_approval` status survives — proving the event made it
        // through, not just that the snapshot status held.
        const { result } = renderHook(() => useStream('chat', 'chat-1'));

        // Live events arrive before snapshot — must be buffered, NOT applied.
        emit(streamStatus('agent-1', 0, 'streaming')); // covered by seqHigh
        emit(streamStatus('agent-1', 1, 'pending_approval')); // survives flush

        // While pending, `status` is still the initial 'idle'.
        expect(result.current.status).toBe('idle');

        // SubscribeResponse with seqHigh=0 drops _seq=0 (snapshot dup), keeps _seq=1.
        emit(subscribeResponse({ status: 'streaming', agentMessageId: 'agent-1', seqHigh: 0 }));

        await waitFor(() => {
            expect(result.current.status).toBe('pending_approval');
        });
        expect(result.current.agentMessageId).toBe('agent-1');

        const diagnostics = bufferDiagnosticsFor(TOPIC);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({
            buffered: 2,
            seq_high: 0,
            dropped_snapshot_duplicates: 1,
            replayed: 1,
        });
    });

    it('applies live events when seqHigh = -1 (no broadcasts before subscribe)', async () => {
        const { result } = renderHook(() => useStream('chat', 'chat-1'));

        // Server's subscribe returns -1 when broadcastSeq is still 0 (no
        // events have flowed yet). Any buffered event with _seq >= 0 must
        // pass the `_seq <= seqHigh` (-1) gate.
        emit(streamStatus('agent-1', 0, 'pending_approval'));

        emit(subscribeResponse({ status: 'streaming', agentMessageId: 'agent-1', seqHigh: -1 }));

        await waitFor(() => {
            expect(result.current.status).toBe('pending_approval');
        });

        const diagnostics = bufferDiagnosticsFor(TOPIC);
        expect(diagnostics[0]).toMatchObject({
            buffered: 1,
            seq_high: -1,
            dropped_snapshot_duplicates: 0,
            replayed: 1,
        });
    });

    it('flushes buffered events in ascending _seq order even when they arrived out of order', async () => {
        // Buffer order on the wire vs. flush order — the buffer sorts by _seq
        // before replay, so the FINAL status reflects the highest _seq, not
        // the wire arrival order.
        const { result } = renderHook(() => useStream('chat', 'chat-1'));

        emit(streamStatus('agent-1', 2, 'pending_approval'));
        emit(streamStatus('agent-1', 1, 'streaming'));

        emit(subscribeResponse({ status: 'streaming', agentMessageId: 'agent-1', seqHigh: 0 }));

        await waitFor(() => {
            expect(result.current.status).toBe('pending_approval');
        });
    });

    it('keys dedup per agentMessageId — a new stream replays from low _seq without being dropped', async () => {
        // Stage 1 invariant: dedup state is scoped per `agentMessageId`, not
        // globally. If we end stream A at lastAppliedSeq=5 and then stream B
        // starts with _seq=0, B's event MUST apply. A global counter would
        // drop B as a stale duplicate — real event loss.
        const { result } = renderHook(() => useStream('chat', 'chat-1'));

        // Stream A: subscribe → run lastAppliedSeq.a to 5 via live events.
        emit(subscribeResponse({ status: 'streaming', agentMessageId: 'agent-a', seqHigh: -1 }));
        await waitFor(() => expect(result.current.agentMessageId).toBe('agent-a'));

        emit(streamEvent('agent-a', 5, { type: 'status_update', status: 'streamA-final' }));
        await waitFor(() => expect(result.current.displayStatus).toBe('streamA-final'));

        // Stream B starts within the same subscription via stream_started.
        emit({
            topic: TOPIC,
            type: ServerMsg.StreamStarted,
            agentMessageId: 'agent-b',
        });
        await waitFor(() => expect(result.current.agentMessageId).toBe('agent-b'));

        // A live event for stream B with _seq=0 — much less than agent-a's
        // last applied (5). Per-id dedup means it MUST be applied.
        emit(streamEvent('agent-b', 0, { type: 'status_update', status: 'streamB-first' }));
        await waitFor(() => expect(result.current.displayStatus).toBe('streamB-first'));

        // Sanity: no seq-regression diagnostic was emitted for agent-b — the
        // event was treated as a fresh stream, not a regression in agent-a.
        const regressionCalls = posthogCalls.filter((c) => c.event === 'stream_seq_regression');
        expect(regressionCalls).toHaveLength(0);
    });

    it('drops live duplicate _seq events for the same agentMessageId after the snapshot', async () => {
        const { result } = renderHook(() => useStream('chat', 'chat-1'));

        emit(subscribeResponse({ status: 'streaming', agentMessageId: 'agent-1', seqHigh: -1 }));
        await waitFor(() => expect(result.current.agentMessageId).toBe('agent-1'));

        emit(streamEvent('agent-1', 0, { type: 'status_update', status: 'first' }));
        await waitFor(() => expect(result.current.displayStatus).toBe('first'));

        // Same _seq again — duplicate. State must NOT change.
        emit(streamEvent('agent-1', 0, { type: 'status_update', status: 'duplicate' }));
        // Still 'first'.
        expect(result.current.displayStatus).toBe('first');

        emit(streamEvent('agent-1', 1, { type: 'status_update', status: 'second' }));
        await waitFor(() => expect(result.current.displayStatus).toBe('second'));

        const dupCalls = posthogCalls.filter((c) => c.event === 'stream_seq_duplicate_dropped');
        expect(dupCalls).toHaveLength(1);
        expect(dupCalls[0].properties).toMatchObject({
            agent_message_id: 'agent-1',
            seq: 0,
            last_seq: 0,
        });
    });

    it('treats a large _seq regression as a server-side reset and applies the event', async () => {
        // Mid-stream DO crash reloads `broadcastSeq` from a stale persist
        // window — new events get assigned recycled _seq values. The FE must
        // detect the regression (more than SEQ_REGRESSION_TOLERANCE below
        // lastAppliedSeq) and apply, not silently drop.
        const { result } = renderHook(() => useStream('chat', 'chat-1'));

        emit(subscribeResponse({ status: 'streaming', agentMessageId: 'agent-1', seqHigh: -1 }));
        await waitFor(() => expect(result.current.agentMessageId).toBe('agent-1'));

        emit(streamEvent('agent-1', 10, { type: 'status_update', status: 'high-water' }));
        await waitFor(() => expect(result.current.displayStatus).toBe('high-water'));

        // _seq=0 is 10 below the last applied — well beyond tolerance.
        // Must apply (server reset) and reset lastAppliedSeq for this id.
        emit(streamEvent('agent-1', 0, { type: 'status_update', status: 'after-reset' }));
        await waitFor(() => expect(result.current.displayStatus).toBe('after-reset'));

        const regressionCalls = posthogCalls.filter((c) => c.event === 'stream_seq_regression');
        expect(regressionCalls).toHaveLength(1);
        expect(regressionCalls[0].properties).toMatchObject({
            agent_message_id: 'agent-1',
            seq: 0,
            last_seq: 10,
        });

        // After the reset, _seq=1 from the "new" sequence space applies normally.
        emit(streamEvent('agent-1', 1, { type: 'status_update', status: 'after-reset-2' }));
        await waitFor(() => expect(result.current.displayStatus).toBe('after-reset-2'));
    });

    it('ignores a duplicate SubscribeResponse — second one does not re-flush buffered events', async () => {
        // FE force-sends a Subscribe alongside `resubscribeAll` or the
        // SharedWebsocketClient first-connect path — server is idempotent
        // and returns two responses. The hook MUST process only the first,
        // gated by `subscribePendingRef`.
        const { result } = renderHook(() => useStream('chat', 'chat-1'));

        emit(streamStatus('agent-1', 0, 'pending_approval'));
        emit(subscribeResponse({ status: 'streaming', agentMessageId: 'agent-1', seqHigh: -1 }));

        await waitFor(() => {
            expect(result.current.status).toBe('pending_approval');
        });
        expect(bufferDiagnosticsFor(TOPIC)).toHaveLength(1);

        // Second SubscribeResponse arrives — should be ignored. No new flush
        // diagnostic, no state change from a second snapshot apply (we use
        // a different agentMessageId in the second response to make any
        // accidental apply visible).
        emit(subscribeResponse({ status: 'streaming', agentMessageId: 'agent-2', seqHigh: 99 }));
        // No new flush event — ref-guarded out.
        expect(bufferDiagnosticsFor(TOPIC)).toHaveLength(1);
        // ownedAgentMessageId remains 'agent-1' — the second response was dropped.
        expect(result.current.agentMessageId).toBe('agent-1');
    });
});
