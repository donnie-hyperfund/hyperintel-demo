import { DurableObject } from 'cloudflare:workers';
import type { StreamBlock } from '@common/ai/agent/types';
import { writeStreamMetric } from '@worker/vendor/analytics-engine';
import type { ActiveDocument, PendingDecision, StreamEvent, StreamSnapshot, StreamStatus } from '@/lib/schema/stream';

// ============================================================================
// SNAPSHOT VERSIONING
// ============================================================================

const SNAPSHOT_VERSION = 1;

type SnapshotBlobV1 = {
    blocks: StreamBlock[];
    activeDocuments: [string, ActiveDocument][];
    pendingDecisions: [string, PendingDecision][];
    currentTextBlockId: string | null;
    currentReasoningBlockId: string | null;
    displayStatus: string | null;
    status: StreamStatus | 'idle';
};

type SnapshotBlob = SnapshotBlobV1;

/**
 * Migrate a persisted blob from `fromVersion` to current.
 * Each version bump adds a case that transforms the previous shape.
 */
function migrateBlob(blob: unknown, fromVersion: number): SnapshotBlob {
    if (fromVersion === SNAPSHOT_VERSION) return blob as SnapshotBlob;
    // Future migrations:
    // if (fromVersion === 1) { blob = migrateV1toV2(blob); fromVersion = 2; }
    throw new Error(`Unknown snapshot version ${fromVersion} — cannot migrate to ${SNAPSHOT_VERSION}`);
}

// ============================================================================
// OUTBOX ENTRY SHAPES (received from ChatStreamDO outbox)
// ============================================================================

type OutboxStreamEvent = {
    _seq: number;
    type: 'stream_event';
    event: StreamEvent;
    [key: string]: unknown;
};

type OutboxStreamStatus = {
    _seq: number;
    type: 'stream_status';
    status: StreamStatus;
    [key: string]: unknown;
};

type OutboxEntry = OutboxStreamEvent | OutboxStreamStatus;

// ============================================================================
// STORAGE KEYS
// ============================================================================

const SK_SEQ_HIGH = 'seqHigh';
const SK_SNAPSHOT_VERSION = 'snapshotVersion';
const SK_SNAPSHOT_BLOB = 'snapshotBlob';

// ============================================================================
// CHAT STREAM STATE DO
// ============================================================================

/**
 * ChatStreamStateDO — owns reducer (applyEvent), snapshot persistence, and
 * idempotent replay by _seq. Keyed by agentMessageId (same as ChatStreamDO).
 *
 * Populated asynchronously by ChatStreamDO's pendingApply chain; queried on
 * subscribe for the latest snapshot + seqHigh.
 *
 * Snapshot is stored as a versioned blob — migrations-on-read ensure forward
 * compatibility when the snapshot shape evolves.
 */
export class ChatStreamStateDO extends DurableObject<StreamStateEnv> {
    private seqHigh = -1;
    private initialized = false;

    // --- Mutable reducer state (mirrors ChatStreamDO's in-memory fields) ---
    private blocks: StreamBlock[] = [];
    private activeDocuments = new Map<string, ActiveDocument>();
    private pendingDecisions = new Map<string, PendingDecision>();
    private currentTextBlockId: string | null = null;
    private currentReasoningBlockId: string | null = null;
    private displayStatus: string | null = null;
    private status: StreamStatus | 'idle' = 'idle';

    private trackMetric(metric: string, doubles?: number[], blobs: Array<string | null | undefined> = []) {
        writeStreamMetric(this.env, {
            metric,
            indexes: [this.ctx.id.name ?? this.ctx.id.toString()],
            blobs,
            doubles,
        });
    }

    async getSnapshot(): Promise<{ snapshot: StreamSnapshot; seqHigh: number }> {
        await this.ensureLoaded();
        const snapshot: StreamSnapshot = {
            blocks: this.blocks,
            activeDocuments: [...this.activeDocuments.values()],
            pendingDecisions: [...this.pendingDecisions.values()],
            status: this.status === 'idle' ? 'streaming' : this.status,
            displayStatus: this.displayStatus,
        };
        return { snapshot, seqHigh: this.seqHigh };
    }

    async applyEvents(events: OutboxEntry[]): Promise<{ ackSeqHigh: number }> {
        const t0 = performance.now();
        await this.ensureLoaded();

        // Pre-validate sequence and outbox envelope before mutating state.
        // Event-type validation stays centralized in applyEvent()'s switch.
        let duplicateCount = 0;
        let expectedSeq = this.seqHigh;
        for (const entry of events) {
            if (entry._seq <= expectedSeq) {
                duplicateCount++;
                continue;
            }
            if (entry._seq !== expectedSeq + 1) {
                this.trackMetric('state_do_gap_throw', [1], [`expected=${expectedSeq + 1},got=${entry._seq}`]);
                throw new Error(`Gap: expected seq ${expectedSeq + 1}, got ${entry._seq}`);
            }
            if (entry.type !== 'stream_event' && entry.type !== 'stream_status') {
                throw new Error(`Unknown outbox entry type: ${(entry as { type: string }).type}`);
            }
            expectedSeq = entry._seq;
        }
        if (duplicateCount > 0) {
            this.trackMetric('state_do_duplicate_drop', [duplicateCount]);
        }

        const rollback = this.captureReducerState();
        try {
            for (const entry of events) {
                if (entry._seq <= this.seqHigh) continue;

                if (entry.type === 'stream_event') {
                    this.applyEvent(entry.event);
                } else if (entry.type === 'stream_status') {
                    this.status = entry.status;
                }

                this.seqHigh = entry._seq;
            }

            await this.persistSnapshot();
        } catch (err) {
            this.restoreReducerState(rollback);
            throw err;
        }

        this.trackMetric('state_do_apply', [performance.now() - t0, events.length, this.seqHigh]);
        return { ackSeqHigh: this.seqHigh };
    }

    /** Reset state for a new stream lifecycle (called when ChatStreamDO re-inits). */
    async reset(): Promise<void> {
        this.blocks = [];
        this.activeDocuments.clear();
        this.pendingDecisions.clear();
        this.currentTextBlockId = null;
        this.currentReasoningBlockId = null;
        this.displayStatus = null;
        this.status = 'idle';
        this.seqHigh = -1;
        this.initialized = true;
        await this.ctx.storage.deleteAll();
    }

    /** Stream finalized — DB has the source of truth, runtime snapshot is disposable. */
    async dispose(): Promise<void> {
        await this.reset();
    }

    // ========================================================================
    // EVENT APPLY LOGIC (ported from ChatStreamDO)
    // ========================================================================

    private applyEvent(event: StreamEvent): void {
        switch (event.type) {
            // --- Text ---
            case 'delta': {
                if (!this.currentTextBlockId) {
                    const blockId = event.blockId || `text-${Date.now()}`;
                    this.currentTextBlockId = blockId;
                    this.blocks.push({ id: blockId, type: 'text', content: '' });
                }
                const textBlock = this.blocks.find((b) => b.id === this.currentTextBlockId);
                if (textBlock) textBlock.content += event.text;
                break;
            }

            case 'created':
                break;

            // --- Reasoning ---
            case 'reasoning_start': {
                const blockId = event.blockId || `reasoning-${Date.now()}`;
                this.currentReasoningBlockId = blockId;
                this.blocks.push({ id: blockId, type: 'reasoning', content: '' });
                break;
            }

            case 'reasoning_delta': {
                if (this.currentReasoningBlockId) {
                    const block = this.blocks.find((b) => b.id === this.currentReasoningBlockId);
                    if (block) block.content += event.text || event.content || '';
                }
                break;
            }

            case 'reasoning_done': {
                if (this.currentReasoningBlockId) {
                    const block = this.blocks.find((b) => b.id === this.currentReasoningBlockId);
                    if (block && block.type === 'reasoning' && event.durationMs !== undefined) {
                        block.durationMs = event.durationMs;
                    }
                }
                this.currentReasoningBlockId = null;
                break;
            }

            // --- Tool calls ---
            case 'tool_start': {
                this.blocks.push({
                    id: event.id || `tool-${Date.now()}`,
                    type: 'tool_call',
                    content: '',
                    toolName: event.tool,
                    toolInput: {},
                    toolCallId: event.id,
                });
                break;
            }

            case 'tool_call_complete': {
                const toolBlock = this.blocks.find((b) => b.type === 'tool_call' && b.toolCallId === event.id);
                if (toolBlock && toolBlock.type === 'tool_call') {
                    toolBlock.toolInput = event.input;
                }
                break;
            }

            case 'tool_result': {
                const toolBlock = this.blocks.find((b) => b.type === 'tool_call' && b.toolCallId === event.id);
                if (toolBlock && toolBlock.type === 'tool_call') {
                    const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
                    toolBlock.content = result;
                    toolBlock.toolOutput = result;
                    toolBlock.toolSuccess = event.success;
                }
                break;
            }

            // --- Search & citations ---
            case 'search_start': {
                this.blocks.push({
                    id: event.blockId || `search-${Date.now()}`,
                    type: 'search',
                    content: event.query,
                    searchQuery: event.query,
                });
                break;
            }

            case 'search_results': {
                const searchBlock = this.blocks.find((b) => b.id === event.blockId && b.type === 'search');
                if (searchBlock && searchBlock.type === 'search') {
                    searchBlock.resultCount = event.resultCount;
                    searchBlock.isComplete = true;
                }
                break;
            }

            case 'citation': {
                const parentBlock = this.blocks.find((b) => b.id === event.parentTextBlockId && b.type === 'text');
                if (parentBlock && parentBlock.type === 'text') {
                    if (!parentBlock.citations) parentBlock.citations = [];
                    parentBlock.citations.push({
                        url: event.url,
                        title: event.title,
                        cited_text: event.citedText,
                        start_index: event.startIndex,
                        end_index: event.endIndex,
                        provider: 'anthropic',
                    });
                }
                break;
            }

            // --- Documents/artifacts ---
            case 'document_start': {
                const allowLoadedContent = event.mode === 'edit' && event.isInternal !== true;
                const baseContent = allowLoadedContent ? (event.loadedContent ?? '') : '';
                this.activeDocuments.set(event.artifactId, {
                    artifactId: event.artifactId,
                    name: event.name,
                    title: event.title ?? event.name,
                    mode: event.mode ?? 'create',
                    pendingVersion: event.pendingVersion,
                    loadedVersion: event.loadedVersion,
                    content: baseContent,
                    loadedContent: allowLoadedContent ? baseContent : undefined,
                    documentType: event.documentType,
                    isInternal: event.isInternal,
                });
                break;
            }

            case 'document_delta': {
                const doc = this.activeDocuments.get(event.artifactId);
                if (doc) doc.content += event.content;
                break;
            }

            case 'document_edit': {
                const doc = this.activeDocuments.get(event.artifactId);
                if (doc) {
                    let lines = doc.content.split('\n');
                    for (const edit of event.edits) {
                        const before = lines.slice(0, Math.max(0, edit.startLine - 1));
                        const after = lines.slice(edit.endLine);
                        const replacement = edit.newContent.split('\n');
                        lines = [...before, ...replacement, ...after];
                    }
                    doc.content = lines.join('\n');
                }
                break;
            }

            case 'document_progress': {
                const doc = this.activeDocuments.get(event.artifactId);
                if (doc) doc.progress = event.progress;
                break;
            }

            // --- Summaries (internal-doc auto-generated summaries) ---
            case 'summary_start': {
                const doc = this.activeDocuments.get(event.artifactId);
                if (doc) {
                    doc.summaryInternal = '';
                    doc.summaryVersionId = event.versionId;
                }
                break;
            }

            case 'summary_delta': {
                const doc = this.activeDocuments.get(event.artifactId);
                if (doc?.summaryVersionId === event.versionId) {
                    doc.summaryInternal = (doc.summaryInternal ?? '') + event.content;
                }
                break;
            }

            case 'summary_complete': {
                const doc = this.activeDocuments.get(event.artifactId);
                if (doc?.summaryVersionId === event.versionId) {
                    doc.summaryInternal = event.content;
                    delete doc.summaryVersionId;
                }
                break;
            }

            case 'document_complete': {
                this.activeDocuments.delete(event.artifactId);
                break;
            }

            // --- User decision prompts ---
            case 'decision_prompt': {
                this.pendingDecisions.set(event.toolCallId, {
                    toolCallId: event.toolCallId,
                    question: event.question,
                    options: event.options,
                    context: event.context,
                });
                break;
            }

            case 'decision_resolved': {
                this.pendingDecisions.delete(event.toolCallId);
                break;
            }

            // --- Status & terminal (no-op in reducer — status managed by stream_status entries) ---
            case 'status_update':
                this.displayStatus = event.status;
                break;
            case 'done':
            case 'done_ext':
            case 'error':
                break;

            // --- Safety ---
            case 'safety_retract':
                // Safety retractions are FE-only instructions (hide retracted content).
                // No snapshot state mutation needed.
                break;

            default: {
                const eventType = (event as { type: string }).type;
                this.trackMetric('state_do_unknown_event', [1], [eventType]);
                const _exhaustive: never = event;
                throw new Error(`Unknown event type: ${eventType}`);
            }
        }
    }

    // ========================================================================
    // PERSISTENCE
    // ========================================================================

    private async persistSnapshot(): Promise<void> {
        const t0 = performance.now();
        const blob: SnapshotBlob = {
            blocks: this.blocks,
            activeDocuments: [...this.activeDocuments.entries()],
            pendingDecisions: [...this.pendingDecisions.entries()],
            currentTextBlockId: this.currentTextBlockId,
            currentReasoningBlockId: this.currentReasoningBlockId,
            displayStatus: this.displayStatus,
            status: this.status,
        };
        const blobSize = JSON.stringify(blob).length;
        await this.ctx.storage.put({
            [SK_SEQ_HIGH]: this.seqHigh,
            [SK_SNAPSHOT_VERSION]: SNAPSHOT_VERSION,
            [SK_SNAPSHOT_BLOB]: blob,
        });
        this.trackMetric('state_do_persist', [performance.now() - t0, blobSize]);
    }

    private captureReducerState(): SnapshotBlobV1 & { seqHigh: number } {
        return {
            seqHigh: this.seqHigh,
            blocks: structuredClone(this.blocks),
            activeDocuments: structuredClone([...this.activeDocuments.entries()]),
            pendingDecisions: structuredClone([...this.pendingDecisions.entries()]),
            currentTextBlockId: this.currentTextBlockId,
            currentReasoningBlockId: this.currentReasoningBlockId,
            displayStatus: this.displayStatus,
            status: this.status,
        };
    }

    private restoreReducerState(state: SnapshotBlobV1 & { seqHigh: number }): void {
        this.seqHigh = state.seqHigh;
        this.blocks = state.blocks;
        this.activeDocuments = new Map(state.activeDocuments);
        this.pendingDecisions = new Map(state.pendingDecisions);
        this.currentTextBlockId = state.currentTextBlockId;
        this.currentReasoningBlockId = state.currentReasoningBlockId;
        this.displayStatus = state.displayStatus;
        this.status = state.status;
    }

    private async ensureLoaded(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;

        const [seqHigh, version, blob] = await Promise.all([
            this.ctx.storage.get<number>(SK_SEQ_HIGH),
            this.ctx.storage.get<number>(SK_SNAPSHOT_VERSION),
            this.ctx.storage.get<unknown>(SK_SNAPSHOT_BLOB),
        ]);

        this.seqHigh = seqHigh ?? -1;

        if (blob && version) {
            const migrated = migrateBlob(blob, version);
            this.blocks = migrated.blocks;
            this.activeDocuments = new Map(migrated.activeDocuments);
            this.pendingDecisions = new Map(migrated.pendingDecisions);
            this.currentTextBlockId = migrated.currentTextBlockId;
            this.currentReasoningBlockId = migrated.currentReasoningBlockId;
            this.displayStatus = migrated.displayStatus;
            this.status = migrated.status;
        }
    }
}
