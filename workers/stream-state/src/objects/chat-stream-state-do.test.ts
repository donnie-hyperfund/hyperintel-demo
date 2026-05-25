import { MockDurableObjectId, MockDurableObjectState, MockDurableObjectStorage } from '@common/common/local.do-mock';
import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent, StreamSnapshot, StreamStatus } from '@/lib/schema/stream';
import { ChatStreamStateDO } from './chat-stream-state-do';

// ============================================================================
// HELPERS
// ============================================================================

function createEnv(): StreamStateEnv {
    return {
        STREAM_AE: { writeDataPoint: vi.fn() },
    } as unknown as StreamStateEnv;
}

function createStateDO(storage?: MockDurableObjectStorage) {
    const ctx = new MockDurableObjectState(new MockDurableObjectId('agent-1'), storage);
    const env = createEnv();
    const state = new ChatStreamStateDO(ctx as unknown as DurableObjectState, env);
    return { ctx, state, env };
}

function streamEvent(seq: number, event: StreamEvent) {
    return {
        _seq: seq,
        type: 'stream_event' as const,
        topic: 'chat:c1',
        agentMessageId: 'agent-1',
        event,
    };
}

function streamStatus(seq: number, status: StreamStatus) {
    return {
        _seq: seq,
        type: 'stream_status' as const,
        topic: 'chat:c1',
        agentMessageId: 'agent-1',
        status,
    };
}

// ============================================================================
// TESTS
// ============================================================================

describe('ChatStreamStateDO', () => {
    describe('basic apply + getSnapshot', () => {
        it('applies delta events and returns them in snapshot', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, { type: 'delta', text: 'hello' }),
                streamEvent(1, { type: 'delta', text: ' world' }),
            ]);

            const { snapshot, seqHigh } = await state.getSnapshot();
            expect(seqHigh).toBe(1);
            expect(snapshot.blocks).toHaveLength(1);
            expect(snapshot.blocks[0].content).toBe('hello world');
            expect(snapshot.blocks[0].type).toBe('text');
        });

        it('returns empty snapshot before any events', async () => {
            const { state } = createStateDO();

            const { snapshot, seqHigh } = await state.getSnapshot();
            expect(seqHigh).toBe(-1);
            expect(snapshot.blocks).toEqual([]);
            expect(snapshot.activeDocuments).toEqual([]);
            expect(snapshot.pendingDecisions).toEqual([]);
            expect(snapshot.status).toBe('streaming'); // 'idle' → 'streaming' in getSnapshot
            expect(snapshot.displayStatus).toBeNull();
        });
    });

    describe('stream_status handling', () => {
        it('updates status from stream_status entries', async () => {
            const { state } = createStateDO();

            await state.applyEvents([streamStatus(0, 'streaming')]);
            expect((await state.getSnapshot()).snapshot.status).toBe('streaming');

            await state.applyEvents([streamStatus(1, 'pending_approval')]);
            expect((await state.getSnapshot()).snapshot.status).toBe('pending_approval');

            await state.applyEvents([streamStatus(2, 'done')]);
            expect((await state.getSnapshot()).snapshot.status).toBe('done');
        });

        it('handles interleaved events and status', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, { type: 'delta', text: 'thinking...' }),
                streamStatus(1, 'pending_approval'),
                streamStatus(2, 'streaming'),
                streamEvent(3, { type: 'delta', text: ' done' }),
                streamStatus(4, 'done'),
            ]);

            const { snapshot, seqHigh } = await state.getSnapshot();
            expect(seqHigh).toBe(4);
            expect(snapshot.status).toBe('done');
            expect(snapshot.blocks[0].content).toBe('thinking... done');
        });
    });

    describe('full reducer coverage', () => {
        it('applies reasoning events', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, { type: 'reasoning_start', blockId: 'r-1' }),
                streamEvent(1, { type: 'reasoning_delta', text: 'hmm', blockId: 'r-1' }),
                streamEvent(2, { type: 'reasoning_done', durationMs: 500, blockId: 'r-1' }),
            ]);

            const { snapshot } = await state.getSnapshot();
            expect(snapshot.blocks).toHaveLength(1);
            const block = snapshot.blocks[0];
            expect(block.type).toBe('reasoning');
            expect(block.content).toBe('hmm');
            if (block.type === 'reasoning') {
                expect(block.durationMs).toBe(500);
            }
        });

        it('applies tool call events', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, { type: 'tool_start', id: 't-1', tool: 'search' }),
                streamEvent(1, { type: 'tool_call_complete', id: 't-1', tool: 'search', input: { query: 'test' } }),
                streamEvent(2, { type: 'tool_result', id: 't-1', result: 'found', success: true }),
            ]);

            const { snapshot } = await state.getSnapshot();
            expect(snapshot.blocks).toHaveLength(1);
            const block = snapshot.blocks[0];
            expect(block.type).toBe('tool_call');
            if (block.type === 'tool_call') {
                expect(block.toolName).toBe('search');
                expect(block.toolInput).toEqual({ query: 'test' });
                expect(block.toolOutput).toBe('found');
                expect(block.toolSuccess).toBe(true);
            }
        });

        it('applies search and citation events', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, { type: 'delta', text: 'result', blockId: 'text-1' }),
                streamEvent(1, { type: 'search_start', query: 'test', blockId: 'search-1' }),
                streamEvent(2, { type: 'search_results', blockId: 'search-1', resultCount: 3 }),
                streamEvent(3, {
                    type: 'citation',
                    url: 'https://example.com',
                    title: 'Example',
                    citedText: 'cited',
                    blockId: 'cite-1',
                    parentTextBlockId: 'text-1',
                    startIndex: 0,
                    endIndex: 6,
                }),
            ]);

            const { snapshot } = await state.getSnapshot();
            expect(snapshot.blocks).toHaveLength(2); // text + search
            const searchBlock = snapshot.blocks.find((b) => b.type === 'search');
            expect(searchBlock).toBeDefined();
            if (searchBlock?.type === 'search') {
                expect(searchBlock.resultCount).toBe(3);
                expect(searchBlock.isComplete).toBe(true);
            }
            const textBlock = snapshot.blocks.find((b) => b.type === 'text');
            if (textBlock?.type === 'text') {
                expect(textBlock.citations).toHaveLength(1);
                expect(textBlock.citations![0].url).toBe('https://example.com');
            }
        });

        it('applies document lifecycle events', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, {
                    type: 'document_start',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    title: 'Test Doc',
                    pendingVersion: 1,
                    mode: 'create',
                }),
                streamEvent(1, {
                    type: 'document_delta',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    pendingVersion: 1,
                    content: 'line 1\n',
                }),
                streamEvent(2, {
                    type: 'document_delta',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    pendingVersion: 1,
                    content: 'line 2',
                }),
                streamEvent(3, {
                    type: 'document_progress',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    pendingVersion: 1,
                    progress: 0.5,
                }),
            ]);

            let { snapshot } = await state.getSnapshot();
            expect(snapshot.activeDocuments).toHaveLength(1);
            expect(snapshot.activeDocuments[0].content).toBe('line 1\nline 2');
            expect(snapshot.activeDocuments[0].progress).toBe(0.5);

            await state.applyEvents([
                streamEvent(4, {
                    type: 'document_complete',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    lines: 2,
                    action: 'created',
                }),
            ]);

            ({ snapshot } = await state.getSnapshot());
            expect(snapshot.activeDocuments).toHaveLength(0);
        });

        it('applies document edit events', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, {
                    type: 'document_start',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    pendingVersion: 2,
                    mode: 'edit',
                    loadedContent: 'line A\nline B\nline C',
                }),
                streamEvent(1, {
                    type: 'document_edit',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    pendingVersion: 2,
                    edits: [{ startLine: 2, endLine: 2, oldContent: 'line B', newContent: 'line B modified' }],
                }),
            ]);

            const { snapshot } = await state.getSnapshot();
            expect(snapshot.activeDocuments[0].content).toBe('line A\nline B modified\nline C');
            expect(snapshot.activeDocuments[0].loadedContent).toBe('line A\nline B\nline C');
        });

        it('applies decision prompt and resolved events', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, {
                    type: 'decision_prompt',
                    toolCallId: 'd-1',
                    question: 'Choose',
                    options: [{ value: 'yes', label: 'Yes' }],
                }),
            ]);

            let { snapshot } = await state.getSnapshot();
            expect(snapshot.pendingDecisions).toHaveLength(1);
            expect(snapshot.pendingDecisions[0].toolCallId).toBe('d-1');

            await state.applyEvents([streamEvent(1, { type: 'decision_resolved', toolCallId: 'd-1', value: 'yes' })]);

            ({ snapshot } = await state.getSnapshot());
            expect(snapshot.pendingDecisions).toHaveLength(0);
        });

        it('applies status_update (displayStatus)', async () => {
            const { state } = createStateDO();

            await state.applyEvents([streamEvent(0, { type: 'status_update', status: 'Analyzing data...' })]);

            const { snapshot } = await state.getSnapshot();
            expect(snapshot.displayStatus).toBe('Analyzing data...');
        });

        it('applies summary events to the active document', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, {
                    type: 'document_start',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    title: 'Doc',
                    pendingVersion: 1,
                    mode: 'create',
                }),
                streamEvent(1, {
                    type: 'summary_start',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    versionId: 'v-1',
                    version: 1,
                }),
                streamEvent(2, {
                    type: 'summary_delta',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    versionId: 'v-1',
                    version: 1,
                    content: 'sum',
                }),
                streamEvent(3, {
                    type: 'summary_complete',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    versionId: 'v-1',
                    version: 1,
                    content: 'summary',
                }),
            ]);

            const { snapshot, seqHigh } = await state.getSnapshot();
            expect(seqHigh).toBe(3);
            expect(snapshot.activeDocuments[0].summaryInternal).toBe('summary');
            expect(snapshot.activeDocuments[0].summaryVersionId).toBeUndefined();
        });

        it('handles no-op event types (done, done_ext, error, created, safety_retract)', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, { type: 'created', id: 'msg-1' }),
                streamEvent(1, { type: 'done', outputType: 'text' }),
                streamEvent(2, { type: 'done_ext' }),
                streamEvent(3, { type: 'error', error: 'oops' }),
                streamEvent(4, { type: 'safety_retract', reason: 'leak', severity: 'high', evidence: null }),
            ]);

            const { seqHigh } = await state.getSnapshot();
            expect(seqHigh).toBe(4);
        });
    });

    describe('unknown event rejection', () => {
        it('throws on unknown event type', async () => {
            const { state } = createStateDO();

            await expect(
                state.applyEvents([streamEvent(0, { type: 'totally_unknown' } as unknown as StreamEvent)]),
            ).rejects.toThrow(/Unknown event type: totally_unknown/);
        });

        it('throws on unknown outbox entry type', async () => {
            const { state } = createStateDO();

            await expect(state.applyEvents([{ _seq: 0, type: 'stream_whatnow' } as any])).rejects.toThrow(
                /Unknown outbox entry type/,
            );
        });
    });

    describe('idempotent replay (_seq dedup)', () => {
        it('returns correct ackSeqHigh on normal apply', async () => {
            const { state } = createStateDO();

            const { ackSeqHigh: ack0 } = await state.applyEvents([streamEvent(0, { type: 'delta', text: 'a' })]);
            expect(ack0).toBe(0);

            const { ackSeqHigh: ack2 } = await state.applyEvents([
                streamEvent(1, { type: 'delta', text: 'b' }),
                streamEvent(2, { type: 'delta', text: 'c' }),
            ]);
            expect(ack2).toBe(2);
        });

        it('skips events with _seq <= seqHigh', async () => {
            const { state } = createStateDO();

            await state.applyEvents([streamEvent(0, { type: 'delta', text: 'first' })]);
            // Replay the same event — should be a no-op
            await state.applyEvents([streamEvent(0, { type: 'delta', text: 'first' })]);

            const { snapshot, seqHigh } = await state.getSnapshot();
            expect(seqHigh).toBe(0);
            expect(snapshot.blocks[0].content).toBe('first');
        });

        it('throws on seq gap', async () => {
            const { state } = createStateDO();

            await state.applyEvents([streamEvent(0, { type: 'delta', text: 'first' })]);
            await expect(state.applyEvents([streamEvent(2, { type: 'delta', text: 'gap' })])).rejects.toThrow(
                /Gap: expected seq 1, got 2/,
            );
        });

        it('gap in batch does not partially mutate state (pre-validation)', async () => {
            const { state } = createStateDO();

            // Batch with a valid prefix [0] then a gap [2] — must reject atomically
            await expect(
                state.applyEvents([
                    streamEvent(0, { type: 'delta', text: 'should not apply' }),
                    streamEvent(2, { type: 'delta', text: 'gap' }),
                ]),
            ).rejects.toThrow(/Gap: expected seq 1, got 2/);

            // State must be untouched — seqHigh still -1, no blocks
            const { snapshot, seqHigh } = await state.getSnapshot();
            expect(seqHigh).toBe(-1);
            expect(snapshot.blocks).toEqual([]);
        });

        it('batch with overlap applies only new events', async () => {
            const { state } = createStateDO();

            await state.applyEvents([streamEvent(0, { type: 'delta', text: 'old' })]);

            // Batch contains already-applied seq 0 + new seq 1
            const { ackSeqHigh } = await state.applyEvents([
                streamEvent(0, { type: 'delta', text: 'old' }),
                streamEvent(1, { type: 'delta', text: ' new' }),
            ]);

            expect(ackSeqHigh).toBe(1);
            const { snapshot } = await state.getSnapshot();
            expect(snapshot.blocks[0].content).toBe('old new'); // not 'oldold new'
        });

        it('unknown event type in batch does not partially mutate state', async () => {
            const { state } = createStateDO();

            // Batch: valid seq 0, unknown event at seq 1 — must reject before applying seq 0
            await expect(
                state.applyEvents([
                    streamEvent(0, { type: 'delta', text: 'should not apply' }),
                    streamEvent(1, { type: 'totally_unknown' } as unknown as StreamEvent),
                ]),
            ).rejects.toThrow(/Unknown event type: totally_unknown/);

            const { snapshot, seqHigh } = await state.getSnapshot();
            expect(seqHigh).toBe(-1);
            expect(snapshot.blocks).toEqual([]);
        });
    });

    describe('persistence and reload', () => {
        it('snapshot survives reload via shared storage', async () => {
            const storage = new MockDurableObjectStorage();
            const { state: first } = createStateDO(storage);

            await first.applyEvents([streamEvent(0, { type: 'delta', text: 'persistent' }), streamStatus(1, 'done')]);

            const firstSnap = await first.getSnapshot();
            expect(firstSnap.seqHigh).toBe(1);

            // Simulate reload: new DO instance sharing the same storage
            const { state: second } = createStateDO(storage);
            const secondSnap = await second.getSnapshot();

            expect(secondSnap.seqHigh).toBe(1);
            expect(secondSnap.snapshot.blocks[0].content).toBe('persistent');
            expect(secondSnap.snapshot.status).toBe('done');
        });

        it('reloaded instance continues from correct seqHigh', async () => {
            const storage = new MockDurableObjectStorage();
            const { state: first } = createStateDO(storage);

            await first.applyEvents([streamEvent(0, { type: 'delta', text: 'a' })]);

            const { state: second } = createStateDO(storage);
            await second.applyEvents([streamEvent(1, { type: 'delta', text: 'b' })]);

            const { snapshot, seqHigh } = await second.getSnapshot();
            expect(seqHigh).toBe(1);
            expect(snapshot.blocks[0].content).toBe('ab');
        });

        it('reloaded instance rejects duplicate of already-persisted seq', async () => {
            const storage = new MockDurableObjectStorage();
            const { state: first } = createStateDO(storage);

            await first.applyEvents([streamEvent(0, { type: 'delta', text: 'a' })]);

            const { state: second } = createStateDO(storage);
            // Replay seq 0 — should be a no-op, not an error
            const { ackSeqHigh } = await second.applyEvents([streamEvent(0, { type: 'delta', text: 'a' })]);
            expect(ackSeqHigh).toBe(0);
        });
    });

    describe('reset', () => {
        it('clears all state and storage', async () => {
            const { state, ctx } = createStateDO();

            await state.applyEvents([streamEvent(0, { type: 'delta', text: 'hello' }), streamStatus(1, 'done')]);

            await state.reset();

            const { snapshot, seqHigh } = await state.getSnapshot();
            expect(seqHigh).toBe(-1);
            expect(snapshot.blocks).toEqual([]);
            expect(snapshot.status).toBe('streaming');

            // Storage is empty
            const stored = await ctx.storage.list();
            expect(stored.size).toBe(0);
        });
    });

    describe('dispose', () => {
        it('clears snapshot and storage like reset', async () => {
            const { state, ctx } = createStateDO();

            await state.applyEvents([streamEvent(0, { type: 'delta', text: 'hello' }), streamStatus(1, 'done')]);

            await state.dispose();

            const { snapshot, seqHigh } = await state.getSnapshot();
            expect(seqHigh).toBe(-1);
            expect(snapshot.blocks).toEqual([]);
            expect(snapshot.status).toBe('streaming');

            const stored = await ctx.storage.list();
            expect(stored.size).toBe(0);
        });
    });

    describe('snapshot matches ChatStreamDO subscribe format', () => {
        it('produces StreamSnapshot-compatible shape', async () => {
            const { state } = createStateDO();

            await state.applyEvents([
                streamEvent(0, { type: 'delta', text: 'hello', blockId: 'b1' }),
                streamEvent(1, {
                    type: 'document_start',
                    artifactId: 'artifact-1',
                    name: 'doc-1',
                    title: 'Doc',
                    pendingVersion: 1,
                    mode: 'create',
                }),
                streamEvent(2, {
                    type: 'decision_prompt',
                    toolCallId: 'd-1',
                    question: 'Pick',
                    options: [{ value: 'a', label: 'A' }],
                }),
                streamEvent(3, { type: 'status_update', status: 'Working...' }),
                streamStatus(4, 'streaming'),
            ]);

            const { snapshot } = await state.getSnapshot();

            // Verify shape matches StreamSnapshot
            const typed: StreamSnapshot = snapshot;
            expect(typed.blocks).toHaveLength(1);
            expect(typed.activeDocuments).toHaveLength(1);
            expect(typed.pendingDecisions).toHaveLength(1);
            expect(typed.status).toBe('streaming');
            expect(typed.displayStatus).toBe('Working...');
        });
    });

    describe('state correctness probes', () => {
        function findMetric(env: StreamStateEnv, name: string) {
            return (env.STREAM_AE.writeDataPoint as ReturnType<typeof vi.fn>).mock.calls
                .map((args: any[]) => args[0] as { blobs: string[]; doubles: number[] })
                .filter((dp) => dp.blobs[0] === name);
        }

        it('emits state_do_duplicate_drop on replay of already-applied events', async () => {
            const { state, env } = createStateDO();

            await state.applyEvents([streamEvent(0, { type: 'delta', text: 'a' })]);
            await state.applyEvents([
                streamEvent(0, { type: 'delta', text: 'a' }),
                streamEvent(1, { type: 'delta', text: 'b' }),
            ]);

            const drops = findMetric(env, 'state_do_duplicate_drop');
            expect(drops).toHaveLength(1);
            expect(drops[0].doubles[0]).toBe(1); // 1 duplicate
        });

        it('emits state_do_gap_throw on sequence gap', async () => {
            const { state, env } = createStateDO();

            await expect(state.applyEvents([streamEvent(2, { type: 'delta', text: 'gap' })])).rejects.toThrow(/Gap/);

            const gaps = findMetric(env, 'state_do_gap_throw');
            expect(gaps).toHaveLength(1);
            expect(gaps[0].doubles[0]).toBe(1);
            expect(gaps[0].blobs).toContain('expected=0,got=2');
        });

        it('emits state_do_unknown_event on unrecognized event type', async () => {
            const { state, env } = createStateDO();

            await expect(
                state.applyEvents([streamEvent(0, { type: 'totally_unknown' } as unknown as StreamEvent)]),
            ).rejects.toThrow(/Unknown event type/);

            const unknowns = findMetric(env, 'state_do_unknown_event');
            expect(unknowns).toHaveLength(1);
            expect(unknowns[0].doubles[0]).toBe(1);
            expect(unknowns[0].blobs).toContain('totally_unknown');
        });
    });
});
