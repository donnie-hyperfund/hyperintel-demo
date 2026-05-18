import { DurableObject } from 'cloudflare:workers';
import type { StreamBlock } from '@common/ai/agent/types';
import type {
    ActiveDocument,
    DecisionResult,
    PendingDecision,
    StreamEvent,
    StreamSnapshot,
    StreamStatus,
} from '@/lib/schema/stream';
import { DECISION_DISMISSED_SENTINEL } from '@/lib/schema/stream';
import { type StreamTopicPrefix, StreamTopicPrefixSchema } from '@/lib/schema/stream-topic';
import { writeStreamMetric } from '@/workers/_common/vendor/analytics-engine';

// Re-export shared types for consumers that imported from here
export type {
    ActiveDocument,
    DecisionResult,
    DocumentEdit,
    PendingDecision,
    StreamEvent,
    StreamSnapshot,
    StreamStatus,
} from '@/lib/schema/stream';

export type StreamSubscribeResult =
    | {
          snapshot: StreamSnapshot;
          /** High-water mark in the same coordinate as stream event `_seq`. */
          seqHigh: number;
          streamType?: 'chat' | 'summary';
          /** Outbox tail replay status (flag-on path only). Absent on flag-off. */
          replayStatus?: 'ok' | 'failed';
          stale?: never;
      }
    | {
          /** State DO snapshot unavailable — stream is live but snapshot is degraded. */
          stale: true;
          seqHigh: -1;
      };

type SequencedStreamMessage = {
    topic: string;
    type: 'stream_event' | 'stream_status';
    agentMessageId: string;
} & Record<string, unknown>;

// ============================================================================
// CONSTANTS
// ============================================================================

const DEAD_MAN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const ABORT_WAIT_TIMEOUT_MS = 60_000; // 60 seconds
const TOOL_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const USER_DECISION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
/** How often to flush state to storage during streaming (crash-recovery only). */
const PERSIST_INTERVAL_MS = 1_000;
/** If a sequence gap isn't filled within this window, skip ahead and drain what we have. */
const REORDER_GAP_TIMEOUT_MS = 5_000;
/** Maximum outbox entries before error-terminating the stream. */
const OUTBOX_CAP = 2_000;
/** Initial backoff when state DO is unreachable. */
const STATE_APPLY_BACKOFF_INIT_MS = 1_000;
/** Max backoff cap for state-impaired retries. */
const STATE_APPLY_BACKOFF_MAX_MS = 30_000;
/** Kill switch — flip to `true` when ready for state DO snapshot path in subscribe. */
export const STREAM_STATE_SNAPSHOT = { enabled: false };
const OUTBOX_TABLE = 'outbox';
const OUTBOX_META_TABLE = 'outbox_meta';
const OUTBOX_DDL = [
    `CREATE TABLE IF NOT EXISTS ${OUTBOX_TABLE} (_seq INTEGER PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS ${OUTBOX_META_TABLE} (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
].join('; ');
const META_KEY_LAST_ACKED = 'lastAckedSeq';

// Storage keys
const SK_BLOCKS = 'blocks';
const SK_ACTIVE_DOCS = 'activeDocuments';
const SK_PENDING_DECISIONS = 'pendingDecisions';
const SK_STATUS = 'status';
const SK_SUBSCRIBERS = 'subscribers';
const SK_CHAT_ID = 'chatId';
const SK_AGENT_MSG_ID = 'agentMessageId';
const SK_USER_MSG_ID = 'userMessageId';
const SK_TEXT_BLOCK_ID = 'currentTextBlockId';
const SK_REASONING_BLOCK_ID = 'currentReasoningBlockId';
const SK_TOPIC_PREFIX = 'topicPrefix';
const SK_PREVIEW_ALIAS = 'previewAlias';
const SK_DISPLAY_STATUS = 'displayStatus';
/** Sub-type of the stream (e.g. 'summary'). */
const SK_STREAM_TYPE = 'streamType';
const SK_FIRST_BROADCAST_RECORDED = 'firstBroadcastRecorded';

/**
 * Stable shape diff for shadow parity. Returns `null` if local matches state, otherwise a short
 * blob describing where they first diverged. Deep equality via JSON.stringify is fine because
 * StreamSnapshot fields are plain data with stable key order from the reducer.
 */
function diffSnapshots(local: StreamSnapshot, state: StreamSnapshot): string | null {
    if (local.blocks.length !== state.blocks.length) {
        return `block_count:${local.blocks.length}vs${state.blocks.length}`;
    }
    if (local.activeDocuments.length !== state.activeDocuments.length) {
        return `doc_count:${local.activeDocuments.length}vs${state.activeDocuments.length}`;
    }
    if (local.pendingDecisions.length !== state.pendingDecisions.length) {
        return `decision_count:${local.pendingDecisions.length}vs${state.pendingDecisions.length}`;
    }
    if (local.status !== state.status) return `status:${local.status}vs${state.status}`;
    if (local.displayStatus !== state.displayStatus) return 'displayStatus';
    if (JSON.stringify(local) !== JSON.stringify(state)) return 'deep';
    return null;
}

// ============================================================================
// CHAT STREAM DO
// ============================================================================

/**
 * ChatStream DO — ephemeral per-response stream buffer and signal broker.
 *
 * Keyed by agentMessageId (the same UUID used as the DB message ID).
 * Buffers StreamBlock[] + ActiveDocument[] state, manages subscribers,
 * and provides long-poll RPC for abort/tool approval.
 *
 * Lifecycle: created via init() → push() loop → done() → finalize().
 * Dead-man's switch alarm fires if Worker crashes mid-stream.
 */
export class ChatStreamDO extends DurableObject<ObjectsEnv> {
    // --- Persisted state (survives hibernation via ctx.storage) ---
    private blocks: StreamBlock[] = [];
    private activeDocuments = new Map<string, ActiveDocument>();
    private pendingDecisions = new Map<string, PendingDecision>();
    private status: StreamStatus | 'idle' = 'idle';
    private subscribers = new Map<string, string>(); // userId → UG DO name
    private chatId = '';
    private agentMessageId = '';
    private userMessageId = '';
    /** Topic prefix for UG broadcasts (e.g. 'chat' or 'intake') */
    private topicPrefix: StreamTopicPrefix = 'chat';
    /** Sub-type of this stream — set when known at init time. */
    private streamType: 'chat' | 'summary' | null = null;
    private firstBroadcastRecorded = false;
    /** Preview branch alias — used to resolve the correct DB on dev preview deploys */
    private previewAlias: string | null = null;
    private currentTextBlockId: string | null = null;
    private currentReasoningBlockId: string | null = null;
    private displayStatus: string | null = null;

    // --- In-memory state (lost on hibernation) ---
    private abortResolve: ((value: 'abort' | 'timeout' | 'done') => void) | null = null;
    private approvalResolvers = new Map<string, (approved: boolean) => void>();
    private decisionResolvers = new Map<string, (result: DecisionResult | null) => void>();
    private initialized = false;
    private lastPersistTime = 0;

    // --- Reorder buffer for fire-and-forget push (in-memory only) ---
    private nextExpectedSeq = 0;
    private pendingBatches = new Map<number, StreamEvent[]>();
    /** Timestamp when we first noticed a gap (pendingBatches has items but nextExpectedSeq is missing) */
    private gapDetectedAt: number | null = null;

    // --- Broadcast queue — serializes delivery, prevents interleaving ---
    private broadcastQueue: unknown[][] = [];
    private isBroadcasting = false;
    /** Monotonic counter — included as `_seq` in every WS message for ordering verification */
    private broadcastSeq = 0;
    /** Highest _seq acknowledged by the state DO (safe to prune up to). -1 = nothing acked. */
    private lastAckedSeq = -1;
    /** Current outbox depth — derived from SQL on load, maintained in-memory after. */
    private outboxDepth = 0;

    // --- Pending apply chain (state DO replication) ---
    private pendingApply: Promise<void> = Promise.resolve();
    private stateImpaired = false;
    private stateImpairedAt = 0;
    private stateImpairedBackoffMs = STATE_APPLY_BACKOFF_INIT_MS;
    /** Best-effort: lost on reload, but agentMessageId uniqueness makes stale state unlikely. */
    private resetPending = false;

    // --- Telemetry (4.6a) ---
    private applyChainDepth = 0;
    private pushCount = 0;

    /** Lazy-load state from storage on first RPC call */
    private async ensureLoaded() {
        if (this.initialized) return;
        this.initialized = true;

        const [
            blocks,
            activeDocs,
            pendingDecs,
            status,
            subscribers,
            chatId,
            agentMsgId,
            userMsgId,
            textBlockId,
            reasoningBlockId,
            topicPrefix,
            previewAlias,
            displayStatus,
            streamType,
            firstBroadcastRecorded,
        ] = await Promise.all([
            this.ctx.storage.get<StreamBlock[]>(SK_BLOCKS),
            this.ctx.storage.get<[string, ActiveDocument][]>(SK_ACTIVE_DOCS),
            this.ctx.storage.get<[string, PendingDecision][]>(SK_PENDING_DECISIONS),
            this.ctx.storage.get<StreamStatus | 'idle'>(SK_STATUS),
            this.ctx.storage.get<[string, string][]>(SK_SUBSCRIBERS),
            this.ctx.storage.get<string>(SK_CHAT_ID),
            this.ctx.storage.get<string>(SK_AGENT_MSG_ID),
            this.ctx.storage.get<string>(SK_USER_MSG_ID),
            this.ctx.storage.get<string | null>(SK_TEXT_BLOCK_ID),
            this.ctx.storage.get<string | null>(SK_REASONING_BLOCK_ID),
            this.ctx.storage.get<string>(SK_TOPIC_PREFIX),
            this.ctx.storage.get<string | null>(SK_PREVIEW_ALIAS),
            this.ctx.storage.get<string | null>(SK_DISPLAY_STATUS),
            this.ctx.storage.get<'chat' | 'summary' | null>(SK_STREAM_TYPE),
            this.ctx.storage.get<boolean>(SK_FIRST_BROADCAST_RECORDED),
        ]);

        if (blocks) this.blocks = blocks;
        if (activeDocs) this.activeDocuments = new Map(activeDocs);
        if (pendingDecs) this.pendingDecisions = new Map(pendingDecs);
        if (status) this.status = status;
        if (subscribers) this.subscribers = new Map(subscribers);
        if (chatId) this.chatId = chatId;
        if (agentMsgId) this.agentMessageId = agentMsgId;
        if (userMsgId) this.userMessageId = userMsgId;
        if (textBlockId) this.currentTextBlockId = textBlockId;
        if (reasoningBlockId) this.currentReasoningBlockId = reasoningBlockId;
        if (topicPrefix) {
            const parsedTopicPrefix = StreamTopicPrefixSchema.safeParse(topicPrefix);
            if (parsedTopicPrefix.success) this.topicPrefix = parsedTopicPrefix.data;
        }
        if (previewAlias) this.previewAlias = previewAlias;
        if (displayStatus) this.displayStatus = displayStatus;
        if (streamType === 'chat' || streamType === 'summary') this.streamType = streamType;
        if (typeof firstBroadcastRecorded === 'boolean') this.firstBroadcastRecorded = firstBroadcastRecorded;
        // Initialize SQL tables
        for (const ddl of OUTBOX_DDL.split('; ')) this.ctx.storage.sql.exec(ddl);
        // Derive lastAckedSeq from SQL metadata
        const metaRow = [
            ...this.ctx.storage.sql.exec(`SELECT value FROM ${OUTBOX_META_TABLE} WHERE key = ?`, META_KEY_LAST_ACKED),
        ][0] as { value: number } | undefined;
        this.lastAckedSeq = metaRow?.value ?? -1;
        // Derive broadcastSeq and outboxDepth from SQL (source of truth)
        const maxRow = [...this.ctx.storage.sql.exec(`SELECT MAX(_seq) as m, COUNT(*) as c FROM ${OUTBOX_TABLE}`)][0] as
            | { m: number | null; c: number }
            | undefined;
        if (maxRow && maxRow.m !== null) {
            this.broadcastSeq = (maxRow.m as number) + 1;
            this.outboxDepth = maxRow.c as number;
        } else {
            // Empty outbox — derive from lastAckedSeq if we had prior activity
            this.broadcastSeq = this.lastAckedSeq + 1;
            this.outboxDepth = 0;
        }

        // Reconcile any un-acked outbox entries from a prior lifecycle (crash recovery)
        if (this.lastAckedSeq < this.broadcastSeq - 1) {
            this.chainApply('recovery');
        }
    }

    /** Persist all mutable state to storage */
    private async persistState() {
        const t0 = performance.now();
        await this.ctx.storage.put({
            [SK_BLOCKS]: this.blocks,
            [SK_ACTIVE_DOCS]: [...this.activeDocuments.entries()],
            [SK_PENDING_DECISIONS]: [...this.pendingDecisions.entries()],
            [SK_STATUS]: this.status,
            [SK_SUBSCRIBERS]: [...this.subscribers.entries()],
            [SK_CHAT_ID]: this.chatId,
            [SK_AGENT_MSG_ID]: this.agentMessageId,
            [SK_USER_MSG_ID]: this.userMessageId,
            [SK_TEXT_BLOCK_ID]: this.currentTextBlockId,
            [SK_REASONING_BLOCK_ID]: this.currentReasoningBlockId,
            [SK_TOPIC_PREFIX]: this.topicPrefix,
            [SK_PREVIEW_ALIAS]: this.previewAlias,
            [SK_DISPLAY_STATUS]: this.displayStatus,
            [SK_STREAM_TYPE]: this.streamType,
            [SK_FIRST_BROADCAST_RECORDED]: this.firstBroadcastRecorded,
        });
        this.trackStreamMetric('persist_state', [performance.now() - t0]);
    }

    // ========================================================================
    // EVENT APPLY LOGIC
    // ========================================================================

    /**
     * Apply a StreamEvent to internal state (blocks + activeDocuments).
     * Mirrors the frontend's useStreamReader apply logic.
     */
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
                // Message ID assigned by backend — not relevant for DO state
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
                // Defense-in-depth: only honor loadedContent for non-internal edit mode, regardless of what the producer sent. Guards against future producers/refactors leaking content into DO state for internal docs or non-edit modes.
                const allowLoadedContent = event.mode === 'edit' && event.isInternal !== true;
                const baseContent = allowLoadedContent ? (event.loadedContent ?? '') : '';
                this.activeDocuments.set(event.artifactId, {
                    artifactId: event.artifactId,
                    name: event.name,
                    title: event.title ?? event.name,
                    mode: event.mode ?? 'create',
                    pendingVersion: event.pendingVersion,
                    loadedVersion: event.loadedVersion,
                    // content mutates with deltas/edits; loadedContent preserved separately for reconnect diff UI.
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
                // Applied edits are emitted in replay-safe order.
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

            // --- Status & terminal ---
            case 'status_update':
                this.displayStatus = event.status;
                break;
            case 'done':
            case 'done_ext':
            case 'error':
                // Stream status managed by dedicated RPC methods (done(), abort(), etc.)
                // These events are still broadcast to subscribers for frontend processing
                break;

            default:
                break;
        }
    }

    // ========================================================================
    // BROADCASTING
    // ========================================================================

    private get topic(): string {
        return `${this.topicPrefix}:${this.chatId}`;
    }

    /**
     * Queue messages for broadcast and kick off the serial drain.
     * Callers don't await — push() returns immediately (no stutter).
     *
     * The drain loop merges ALL queued messages before each RPC, so events
     * that accumulate during the round-trip are coalesced into one batch.
     */
    private queueBroadcast(messages: unknown[]) {
        this.broadcastQueue.push(messages);
        void this.drainBroadcastQueue();
    }

    private async queueSequencedBroadcast(messages: SequencedStreamMessage[]) {
        const baseSeq = this.broadcastSeq;
        const sequencedMessages = messages.map((message, i) => ({
            ...message,
            _seq: baseSeq + i,
        }));
        this.broadcastSeq = baseSeq + messages.length;
        try {
            await this.writeOutbox(sequencedMessages);
        } catch (err) {
            this.broadcastSeq = baseSeq;
            throw err;
        }
        await this.persistState();
        this.queueBroadcast(sequencedMessages);
        this.chainApply('broadcast');
    }

    // --- Durable Outbox (SQL-backed, atomic) ---

    /**
     * Persist messages to the outbox before they become visible via broadcast.
     * Enforces the outbox cap — broadcasts error + throws if depth exceeds OUTBOX_CAP.
     * Per-row INSERTs wrapped in transactionSync — atomic, no bind-param limits.
     *
     * Cap overflow: the error broadcast bypasses the outbox intentionally — it is
     * an explicit exception to write-before-broadcast, acceptable because the
     * stream is terminal after this point (status='error' rejects further pushes).
     */
    private async writeOutbox(messages: Array<{ _seq: number; [key: string]: unknown }>) {
        if (messages.length === 0) return;

        const newDepth = this.outboxDepth + messages.length;
        if (newDepth > OUTBOX_CAP) {
            console.error(`[ChatStreamDO] outbox cap exceeded (${newDepth}/${OUTBOX_CAP}), terminating stream`);
            this.status = 'error';
            await this.ctx.storage.put(SK_STATUS, 'error');
            const errorMsg = {
                topic: this.topic,
                type: 'stream_status' as const,
                status: 'error',
                agentMessageId: this.agentMessageId,
                _seq: messages[0]._seq,
            };
            this.queueBroadcast([errorMsg]);
            await this.drainBroadcastQueue();
            throw new Error(`Outbox cap exceeded: ${newDepth} > ${OUTBOX_CAP}`);
        }

        const t0 = performance.now();
        const now = Date.now();
        const payloads = messages.map((msg) => JSON.stringify(msg));
        const entryBytes = payloads.reduce((sum, p) => sum + p.length, 0);
        this.ctx.storage.transactionSync(() => {
            for (let i = 0; i < messages.length; i++) {
                this.ctx.storage.sql.exec(
                    `INSERT INTO ${OUTBOX_TABLE} (_seq, payload, created_at) VALUES (?, ?, ?)`,
                    messages[i]._seq,
                    payloads[i],
                    now,
                );
            }
        });
        this.outboxDepth = newDepth;
        this.trackStreamMetric('outbox_write', [performance.now() - t0, entryBytes]);
    }

    /**
     * Read outbox entries in [startSeq, endSeq] (inclusive).
     * Used by subscribe to fill the gap between state DO snapshot and live.
     */
    async readOutbox(startSeq: number, endSeq: number): Promise<unknown[]> {
        await this.ensureLoaded();
        if (startSeq > endSeq) return [];
        const cursor = this.ctx.storage.sql.exec(
            `SELECT payload FROM ${OUTBOX_TABLE} WHERE _seq >= ? AND _seq <= ? ORDER BY _seq`,
            startSeq,
            endSeq,
        );
        const result: unknown[] = [];
        for (const row of cursor) {
            result.push(JSON.parse(row.payload as string));
        }
        return result;
    }

    /** Verify outbox tail rows cover [expectedStart, expectedEnd] with no gaps. */
    private verifyTailContiguity(tail: unknown[], expectedStart: number, expectedEnd: number): boolean {
        const seqs = tail.map((e) => (e as { _seq: number })._seq);
        if (seqs[0] !== expectedStart) return false;
        if (seqs[seqs.length - 1] !== expectedEnd) return false;
        for (let i = 1; i < seqs.length; i++) {
            if (seqs[i] !== seqs[i - 1] + 1) return false;
        }
        return true;
    }

    /**
     * Acknowledge that the state DO has applied up to `seq`.
     * Prunes outbox entries at or below this seq. Throws on future ACKs.
     */
    async ackSeq(seq: number) {
        await this.ensureLoaded();
        if (seq <= this.lastAckedSeq) return;
        if (seq > this.broadcastSeq - 1) {
            throw new Error(`ackSeq(${seq}) exceeds broadcastSeq-1 (${this.broadcastSeq - 1})`);
        }

        this.ctx.storage.transactionSync(() => {
            this.ctx.storage.sql.exec(`DELETE FROM ${OUTBOX_TABLE} WHERE _seq <= ?`, seq);
            this.ctx.storage.sql.exec(
                `INSERT OR REPLACE INTO ${OUTBOX_META_TABLE} (key, value) VALUES (?, ?)`,
                META_KEY_LAST_ACKED,
                seq,
            );
        });
        this.lastAckedSeq = seq;
        this.outboxDepth = Math.max(0, this.broadcastSeq - (seq + 1));
    }

    // ========================================================================
    // PENDING APPLY CHAIN (state DO replication)
    // ========================================================================

    private getStateDOStub() {
        return this.env.CHAT_STREAM_STATE_DO.get(this.env.CHAT_STREAM_STATE_DO.idFromName(this.agentMessageId));
    }

    /**
     * Read un-acked outbox entries and forward them to the state DO.
     * On success, prune the outbox and clear impaired mode.
     */
    private async reconcileOutbox(trigger = 'push'): Promise<void> {
        const t0 = performance.now();
        let attempted = 0;
        try {
            const stub = this.getStateDOStub();

            // Retry pending reset before applying — ensures state DO is clean for this lifecycle
            if (this.resetPending) {
                await stub.reset();
                this.resetPending = false;
            }

            const startSeq = this.lastAckedSeq + 1;
            const endSeq = this.broadcastSeq - 1;
            if (startSeq > endSeq) return;

            const entries = await this.readOutbox(startSeq, endSeq);
            if (entries.length === 0) return;
            attempted = entries.length;

            const rpcT0 = performance.now();
            const { ackSeqHigh } = await stub.applyEvents(entries as any[]);
            this.trackStreamMetric('state_do_apply_rpc', [performance.now() - rpcT0, attempted, this.applyChainDepth]);
            await this.ackSeq(ackSeqHigh);

            if (this.stateImpaired) {
                const impairedDuration = Date.now() - this.stateImpairedAt;
                this.stateImpaired = false;
                this.stateImpairedBackoffMs = STATE_APPLY_BACKOFF_INIT_MS;
                this.trackStreamMetric('state_impaired_exited', [impairedDuration]);
            }

            this.trackStreamMetric('reconciler_run', [performance.now() - t0, attempted, 1], [trigger]);
        } catch (err) {
            this.trackStreamMetric('reconciler_run', [performance.now() - t0, attempted, 0], [trigger]);
            throw err;
        }
    }

    /**
     * Chain a reconcile onto the serial promise chain.
     * If state DO is impaired, apply bounded exponential backoff.
     */
    private chainApply(trigger = 'push'): void {
        if (this.stateImpaired) {
            if (Date.now() - this.stateImpairedAt < this.stateImpairedBackoffMs) return;
        }

        this.applyChainDepth++;
        this.pendingApply = this.pendingApply
            .then(() => this.reconcileOutbox(trigger))
            .catch((err) => {
                const now = Date.now();
                if (!this.stateImpaired) {
                    console.error('[ChatStreamDO] state DO apply failed, entering state-impaired', err);
                    this.stateImpaired = true;
                    this.stateImpairedAt = now;
                    this.stateImpairedBackoffMs = STATE_APPLY_BACKOFF_INIT_MS;
                    this.trackStreamMetric('state_impaired_entered', [1]);
                } else {
                    this.stateImpairedAt = now;
                    this.stateImpairedBackoffMs = Math.min(this.stateImpairedBackoffMs * 2, STATE_APPLY_BACKOFF_MAX_MS);
                }
            })
            .finally(() => {
                this.applyChainDepth--;
            });
    }

    /**
     * Await the pending apply chain — used at terminal points (done/abort/alarm)
     * to ensure the state DO has everything before the stream ends.
     */
    private async flushApplyChain(trigger = 'terminal'): Promise<void> {
        try {
            await this.pendingApply;
            await this.reconcileOutbox(trigger);
        } catch (err) {
            console.error('[ChatStreamDO] final reconcile failed', err);
        }
    }

    private trackStreamMetric(metric: string, doubles?: number[], blobs: Array<string | null | undefined> = []) {
        writeStreamMetric(this.env, {
            metric,
            indexes: [this.agentMessageId || this.chatId],
            blobs: [this.chatId, this.previewAlias, ...blobs],
            doubles,
        });
    }

    /**
     * Serial drain — only one instance runs at a time (JS mutex via `isBroadcasting`).
     *
     * On each iteration: merge ALL currently queued message arrays → send ONE
     * awaited RPC per subscriber → loop. The await opens the input gate, letting
     * concurrent push() calls queue more events. Those events are merged into
     * the next iteration's RPC — natural coalescing, minimal round-trips.
     *
     * Ordering guarantee: the mutex ensures only one drain runs, and each RPC
     * is awaited before the next. UG's pushMessages uses synchronous ws.send(),
     * so events within a single RPC are atomic and ordered.
     */
    private async drainBroadcastQueue() {
        if (this.isBroadcasting) return;
        this.isBroadcasting = true;
        try {
            while (this.broadcastQueue.length > 0) {
                // Merge all currently queued batches into one
                const merged: unknown[] = [];
                while (this.broadcastQueue.length > 0) {
                    merged.push(...this.broadcastQueue.shift()!);
                }
                await this.sendBatchToSubscribers(merged);
            }
        } finally {
            this.isBroadcasting = false;
        }
    }

    /**
     * Send a merged batch of messages to all subscribers via UG's pushMessages.
     * Each subscriber gets one awaited RPC with all messages (atomic delivery).
     */
    private async sendBatchToSubscribers(messages: unknown[]) {
        if (this.subscribers.size === 0) return;
        this.trackFirstBroadcastAfterRegister(messages.length);
        const sends: Promise<void>[] = [];
        for (const [userId] of this.subscribers) {
            sends.push(this.sendToUG(userId, messages));
        }
        await Promise.allSettled(sends);
    }

    /**
     * Emit the once-per-stream `first_broadcast_after_register` metric. Must not await
     * before iterating subscribers in `sendBatchToSubscribers` — opening the input gate
     * here lets a concurrent `finalize()` clear `this.subscribers` before the broadcast
     * loop runs, dropping the terminal events on error cleanup. The persistence is
     * fire-and-forget; worst case is one duplicate metric emission per DO restart.
     */
    private trackFirstBroadcastAfterRegister(messageCount: number) {
        if (this.firstBroadcastRecorded || !this.agentMessageId) return;
        this.firstBroadcastRecorded = true;
        void this.ctx.storage.put(SK_FIRST_BROADCAST_RECORDED, true);
        this.trackStreamMetric(
            'first_broadcast_after_register',
            [Date.now(), this.subscribers.size, messageCount],
            [this.topicPrefix],
        );
    }

    /** Send messages to a single subscriber's UserGateway (awaited, best-effort). */
    private async sendToUG(userId: string, messages: unknown[]): Promise<void> {
        const ugDoName = this.subscribers.get(userId);
        if (!ugDoName) return;
        try {
            await this.sendToUGStrict(userId, messages);
        } catch (err) {
            console.error(`[ChatStreamDO] sendToUG FAILED: userId=${userId}`, err);
        }
    }

    /** Send messages to a single subscriber's UserGateway — throws on failure. */
    private async sendToUGStrict(userId: string, messages: unknown[]): Promise<void> {
        const ugDoName = this.subscribers.get(userId);
        if (!ugDoName) throw new Error(`No UG mapping for userId=${userId}`);
        const ugId = this.env.USER_GATEWAY.idFromName(ugDoName);
        const ugStub = this.env.USER_GATEWAY.get(ugId) as DurableObjectStub & {
            pushMessages(topic: string, messages: unknown[]): Promise<void>;
        };
        await ugStub.pushMessages(this.topic, messages);
    }

    /** Queue a stream_status message for broadcast. */
    private async broadcastStatus(status: StreamStatus) {
        await this.queueSequencedBroadcast([
            {
                topic: this.topic,
                type: 'stream_status',
                status,
                agentMessageId: this.agentMessageId,
            },
        ]);
    }

    // ========================================================================
    // RPC METHODS
    // ========================================================================

    /**
     * Push stream events with a sequence number for reorder-safe fire-and-forget delivery.
     * Out-of-order batches are buffered until all preceding sequences arrive.
     *
     * Broadcasts are queued and drained serially (mutex + merged batches) to prevent
     * interleaving when concurrent push() calls enter via the open input gate.
     */
    async push(events: StreamEvent[], seq: number) {
        const t0 = performance.now();
        await this.ensureLoaded();

        if (this.status === 'done' || this.status === 'aborted' || this.status === 'error') return;

        if (this.status === 'idle') {
            this.status = 'streaming';
        }

        // Duplicate / already-processed — ignore
        if (seq < this.nextExpectedSeq) {
            this.trackStreamMetric('push_duplicate', [
                performance.now() - t0,
                this.broadcastQueue.length,
                this.broadcastSeq,
                events.length,
            ]);
            return;
        }

        // Buffer this batch
        this.pendingBatches.set(seq, events);

        // Drain consecutive batches in order
        const allDrained: StreamEvent[] = [];
        while (this.pendingBatches.has(this.nextExpectedSeq)) {
            const batch = this.pendingBatches.get(this.nextExpectedSeq)!;
            this.pendingBatches.delete(this.nextExpectedSeq);
            this.nextExpectedSeq++;
            allDrained.push(...batch);
        }

        // Gap detection: if we have buffered batches but the next expected seq is missing,
        // a fire-and-forget push was lost. After REORDER_GAP_TIMEOUT_MS, skip ahead.
        if (this.pendingBatches.size > 0 && allDrained.length === 0) {
            const now2 = Date.now();
            if (!this.gapDetectedAt) {
                this.gapDetectedAt = now2;
                console.warn(
                    `[ChatStreamDO] gap detected: waiting for seq=${this.nextExpectedSeq}, have ${[...this.pendingBatches.keys()].join(',')}`,
                );
            } else if (now2 - this.gapDetectedAt >= REORDER_GAP_TIMEOUT_MS) {
                // Skip ahead to the lowest buffered seq and drain from there
                const sortedSeqs = [...this.pendingBatches.keys()].sort((a, b) => a - b);
                console.warn(
                    `[ChatStreamDO] gap timeout: skipping seq ${this.nextExpectedSeq}→${sortedSeqs[0]}, lost ${sortedSeqs[0] - this.nextExpectedSeq} batch(es)`,
                );
                this.nextExpectedSeq = sortedSeqs[0];
                this.gapDetectedAt = null;
                // Re-drain from the new position
                while (this.pendingBatches.has(this.nextExpectedSeq)) {
                    const batch = this.pendingBatches.get(this.nextExpectedSeq)!;
                    this.pendingBatches.delete(this.nextExpectedSeq);
                    this.nextExpectedSeq++;
                    allDrained.push(...batch);
                }
            }
        } else {
            // No gap — reset detector
            this.gapDetectedAt = null;
        }

        // Outbox write → apply → broadcast. Seq assignment deferred until write
        // succeeds so failed writes don't burn _seq values.
        if (allDrained.length > 0) {
            const baseSeq = this.broadcastSeq;
            const messages = allDrained.map((event, i) => ({
                topic: this.topic,
                type: 'stream_event' as const,
                agentMessageId: this.agentMessageId,
                event,
                _seq: baseSeq + i,
            }));
            // Tentatively advance — rolled back if write fails
            this.broadcastSeq = baseSeq + messages.length;
            try {
                await this.writeOutbox(messages);
            } catch (err) {
                this.broadcastSeq = baseSeq;
                throw err;
            }
            for (const event of allDrained) {
                this.applyEvent(event);
            }
            this.queueBroadcast(messages);
            this.chainApply();
        }

        // Persist + alarm on a throttled schedule (crash-recovery only)
        const now = Date.now();
        if (now - this.lastPersistTime >= PERSIST_INTERVAL_MS) {
            await this.persistState();
            await this.ctx.storage.setAlarm(now + DEAD_MAN_TIMEOUT_MS);
            this.lastPersistTime = now;
        }

        this.trackStreamMetric('push', [
            performance.now() - t0,
            this.broadcastQueue.length,
            this.broadcastSeq,
            events.length,
        ]);

        this.pushCount++;
        if (this.pushCount % 100 === 0) {
            let oldestAge = 0;
            if (this.outboxDepth > 0) {
                const oldest = [...this.ctx.storage.sql.exec(`SELECT MIN(created_at) as t FROM ${OUTBOX_TABLE}`)][0] as
                    | { t: number | null }
                    | undefined;
                if (oldest?.t && oldest.t > 0) oldestAge = Date.now() - oldest.t;
            }
            this.trackStreamMetric('outbox_depth', [this.outboxDepth, oldestAge]);
            this.trackStreamMetric('pending_apply_chain_depth', [this.applyChainDepth]);
        }
    }

    /**
     * Mark stream as done, broadcast terminal status.
     * Awaits drain so status is delivered before the handler calls finalize().
     */
    async done() {
        await this.ensureLoaded();
        // If already terminal (aborted/error), don't override — just resolve dangling promises
        if (this.status === 'aborted' || this.status === 'error') {
            this.abortResolve?.('done');
            this.abortResolve = null;
            return;
        }
        this.status = 'done';
        // Resolve any pending abortWait so the timer doesn't dangle for 60s
        this.abortResolve?.('done');
        this.abortResolve = null;
        await this.broadcastStatus('done');
        await this.drainBroadcastQueue();
        await this.flushApplyChain();
    }

    /**
     * Initialize the DO with chatId and agentMessageId. Must be called once
     * before any subscribe or push. Sets status idle, starts dead-man alarm.
     *
     * Routing — "which agentMessageId is active for this chat topic" — comes
     * from `chats.active_agent_message_id` in SQL (via `getTopicSubscribeInfo`).
     * The DO no longer registers anything in UG storage.
     */
    async init(
        chatId: string,
        agentMessageId: string,
        userMessageId: string,
        topicPrefix: StreamTopicPrefix = 'chat',
        previewAlias?: string,
        streamType?: 'chat' | 'summary',
    ) {
        await this.ensureLoaded();
        this.chatId = chatId;
        this.agentMessageId = agentMessageId;
        this.userMessageId = userMessageId;
        this.topicPrefix = topicPrefix;
        this.previewAlias = previewAlias ?? null;
        this.streamType = streamType ?? null;
        this.status = 'idle';
        this.nextExpectedSeq = 0;
        this.pendingBatches.clear();
        this.gapDetectedAt = null;
        this.broadcastQueue = [];
        this.isBroadcasting = false;
        // Clear any stale outbox entries from a prior lifecycle
        this.ctx.storage.transactionSync(() => {
            this.ctx.storage.sql.exec(`DELETE FROM ${OUTBOX_TABLE}`);
            this.ctx.storage.sql.exec(
                `INSERT OR REPLACE INTO ${OUTBOX_META_TABLE} (key, value) VALUES (?, ?)`,
                META_KEY_LAST_ACKED,
                -1,
            );
        });
        this.broadcastSeq = 0;
        this.lastAckedSeq = -1;
        this.outboxDepth = 0;
        this.pendingApply = Promise.resolve();
        this.stateImpaired = false;
        this.stateImpairedAt = 0;
        this.stateImpairedBackoffMs = STATE_APPLY_BACKOFF_INIT_MS;
        this.resetPending = false;
        this.applyChainDepth = 0;
        this.pushCount = 0;
        await this.persistState();

        // Reset state DO for the new lifecycle
        try {
            await this.getStateDOStub().reset();
            this.resetPending = false;
        } catch (err) {
            console.error('[ChatStreamDO] state DO reset failed during init', err);
            this.stateImpaired = true;
            this.stateImpairedAt = Date.now();
            this.resetPending = true;
        }

        // Start dead-man alarm — if no push() arrives, alarm fires and cleans up
        await this.ctx.storage.setAlarm(Date.now() + DEAD_MAN_TIMEOUT_MS);
    }

    /**
     * Abort the stream — sets status, resolves abort promise, broadcasts.
     * @param chatId — must match the stored chatId or the call is rejected.
     */
    async abort(chatId?: string) {
        await this.ensureLoaded();
        if (chatId && this.chatId && chatId !== this.chatId) {
            throw new Error('chatId mismatch');
        }
        this.status = 'aborted';
        this.abortResolve?.('abort');
        this.abortResolve = null;
        await this.broadcastStatus('aborted');
        await this.drainBroadcastQueue();
        await this.flushApplyChain();
    }

    /**
     * Long-poll that resolves on abort signal or timeout.
     * Worker races this against reader.read().
     */
    async abortWait(): Promise<'abort' | 'timeout' | 'done'> {
        await this.ensureLoaded();

        if (this.status === 'aborted') return 'abort';
        if (this.status === 'done') return 'done';

        // Resolve any previous dangling listener to prevent orphaned promises
        this.abortResolve?.('timeout');

        return new Promise<'abort' | 'timeout' | 'done'>((resolve) => {
            this.abortResolve = resolve;
            setTimeout(() => {
                this.abortResolve = null;
                resolve('timeout');
            }, ABORT_WAIT_TIMEOUT_MS);
        });
    }

    /**
     * Register a subscriber and return the current snapshot.
     *
     * SQL-driven routing means subscribe may arrive in the window between
     * `chats.active_agent_message_id = X` being committed and `init()`
     * completing on DO X. In that window `chatId` is still empty — throw a
     * marker error so `StreamTopicHandler.subscribe` falls through to its
     * `catch` and returns `idle`. The imminent StreamStarted broadcast then
     * catches the client up.
     */
    async subscribe(userId: string, ugDoName: string): Promise<StreamSubscribeResult> {
        const t0 = performance.now();
        await this.ensureLoaded();

        if (this.chatId === '') {
            throw new Error('ChatStreamDO not initialized');
        }

        // Registration must precede snapshot capture so broadcasts during subscribe reach the user's UG.
        this.subscribers.set(userId, ugDoName);
        await this.ctx.storage.put(SK_SUBSCRIBERS, [...this.subscribers.entries()]);

        if (STREAM_STATE_SNAPSHOT.enabled) {
            return this.subscribeFromStateDO(userId, t0);
        }
        return this.subscribeFromLocal(t0);
    }

    /**
     * Flag-on subscribe: state DO snapshot + outbox tail as ordinary WS messages.
     *
     * seqHigh describes the snapshot only (stateSeqHigh). Outbox entries between
     * stateSeqHigh+1 and targetSeqHigh are sent as normal stream_event/stream_status
     * messages to the subscribing user's UG before this method returns. The FE
     * buffers pre-SubscribeResponse messages and flushes them in ascending _seq
     * order, dropping _seq <= seqHigh as snapshot-covered duplicates. The tail
     * events have _seq > stateSeqHigh, so they pass the dedup gate.
     *
     * Correctness does not depend on the reconcile succeeding — if the state DO
     * is fully caught up the tail is empty; if it's behind the outbox fills the gap.
     */
    private async subscribeFromStateDO(userId: string, t0: number): Promise<StreamSubscribeResult> {
        // Capture before any awaits — broadcastSeq may advance during RPCs.
        const targetSeqHigh = this.broadcastSeq - 1;

        // Best-effort reconcile: reduces tail size, not required for correctness.
        try {
            await this.flushApplyChain('subscribe');
        } catch {
            // Outbox tail covers the gap if reconcile fails.
        }

        let snapshot: StreamSnapshot;
        let stateSeqHigh: number;
        try {
            const rpcT0 = performance.now();
            const result = await this.getStateDOStub().getSnapshot();
            snapshot = result.snapshot;
            stateSeqHigh = result.seqHigh;
            this.trackStreamMetric('state_do_get_snapshot_rpc', [
                performance.now() - rpcT0,
                JSON.stringify(snapshot).length,
            ]);
        } catch (err) {
            console.error('[ChatStreamDO] state DO getSnapshot failed', err);
            this.trackStreamMetric('subscribe_get_snapshot_failed');
            return { stale: true as const, seqHigh: -1 };
        }

        let replayStatus: 'ok' | 'failed' = 'ok';

        if (stateSeqHigh < targetSeqHigh) {
            const tail = await this.readOutbox(stateSeqHigh + 1, targetSeqHigh);
            if (tail.length > 0 && this.verifyTailContiguity(tail, stateSeqHigh + 1, targetSeqHigh)) {
                try {
                    await this.sendToUGStrict(userId, tail);
                } catch (err) {
                    console.error('[ChatStreamDO] replay send failed', err);
                    this.trackStreamMetric('subscribe_replay_send_failed');
                    replayStatus = 'failed';
                }
            } else if (tail.length > 0) {
                console.error('[ChatStreamDO] outbox tail not contiguous');
                this.trackStreamMetric('subscribe_tail_contiguity_failed');
                replayStatus = 'failed';
            } else {
                console.error('[ChatStreamDO] outbox tail empty for expected range');
                this.trackStreamMetric('subscribe_tail_empty');
                replayStatus = 'failed';
            }
        }

        const tailSize = Math.max(0, targetSeqHigh - stateSeqHigh);
        this.trackStreamMetric(
            'subscribe',
            [performance.now() - t0, this.subscribers.size, stateSeqHigh],
            ['state_do', String(tailSize)],
        );

        return {
            snapshot,
            seqHigh: stateSeqHigh,
            replayStatus,
            ...(this.streamType ? { streamType: this.streamType } : {}),
        };
    }

    /** Flag-off: local snapshot path (current production behavior). */
    private subscribeFromLocal(t0: number): StreamSubscribeResult {
        this.chainApply('subscribe');

        const snapshot: StreamSnapshot = {
            blocks: this.blocks,
            activeDocuments: [...this.activeDocuments.values()],
            pendingDecisions: [...this.pendingDecisions.values()],
            status: this.status === 'idle' ? 'streaming' : this.status,
            displayStatus: this.displayStatus,
        };

        const seqHigh = this.broadcastSeq - 1;
        this.trackStreamMetric('subscribe', [performance.now() - t0, this.subscribers.size, seqHigh]);

        // Background parity check — proves state DO reducer matches local reducer before flag flip.
        // Out-of-band: never affects the subscribe response.
        // Clone snapshot — `blocks` and the ActiveDocument objects inside `activeDocuments` are still
        // live references into the reducer; structuredClone snapshots them at this point in time so a
        // concurrent push() during the getSnapshot() await can't mutate the comparison.
        void this.shadowCompareToStateDO(structuredClone(snapshot), seqHigh);

        return {
            snapshot,
            seqHigh,
            ...(this.streamType ? { streamType: this.streamType } : {}),
        };
    }

    /**
     * Compare the local reducer's snapshot against the state DO's snapshot and emit a parity metric.
     * Skips emission if state DO is unreachable or lagging (lag is operationally expected pre-flag).
     * Runs out-of-band; never throws into the subscribe path.
     */
    private async shadowCompareToStateDO(local: StreamSnapshot, localSeqHigh: number): Promise<void> {
        try {
            const { snapshot: state, seqHigh: stateSeqHigh } = await this.getStateDOStub().getSnapshot();
            if (stateSeqHigh !== localSeqHigh) {
                this.trackStreamMetric(
                    'snapshot_parity_skip',
                    [localSeqHigh, stateSeqHigh],
                    [stateSeqHigh < localSeqHigh ? 'state_behind' : 'state_ahead'],
                );
                return;
            }
            const divergence = diffSnapshots(local, state);
            this.trackStreamMetric(
                'snapshot_parity_check',
                [divergence ? 0 : 1, localSeqHigh, stateSeqHigh],
                [divergence ?? 'match'],
            );
        } catch {
            // State DO unreachable — state_impaired_entered / subscribe metrics already cover this.
        }
    }

    /**
     * Remove a subscriber.
     */
    async unsubscribe(userId: string) {
        await this.ensureLoaded();
        this.subscribers.delete(userId);
        await this.ctx.storage.put(SK_SUBSCRIBERS, [...this.subscribers.entries()]);
    }

    /**
     * Self-destruct — clear all state, let DO expire.
     * Called by Worker after DB persistence (done -> done_ext processing -> finalize).
     *
     * Routing is owned by SQL `chats.active_agent_message_id` (read on subscribe).
     * No UG-side mapping to clear here.
     */
    async finalize() {
        // Resolve any pending decision long-polls with null so the agent side
        // doesn't hang waiting on a DO that's about to die.
        for (const resolver of this.decisionResolvers.values()) {
            resolver(null);
        }
        this.decisionResolvers.clear();

        // Best-effort state DO cleanup — DB is source of truth after finalize,
        // runtime snapshot is disposable. Must run before agentMessageId is wiped.
        if (this.agentMessageId) {
            try {
                await this.getStateDOStub().dispose();
            } catch (err) {
                console.error('[ChatStreamDO] state DO dispose failed during finalize', err);
                this.trackStreamMetric('state_dispose_failed');
            }
        }

        // Clear in-memory
        this.blocks = [];
        this.activeDocuments.clear();
        this.pendingDecisions.clear();
        this.subscribers.clear();
        this.abortResolve = null;
        this.approvalResolvers.clear();
        this.status = 'idle';
        this.currentTextBlockId = null;
        this.currentReasoningBlockId = null;
        this.streamType = null;
        this.firstBroadcastRecorded = false;
        this.lastAckedSeq = -1;
        this.outboxDepth = 0;
        this.pendingApply = Promise.resolve();
        this.stateImpaired = false;
        this.stateImpairedAt = 0;
        this.stateImpairedBackoffMs = STATE_APPLY_BACKOFF_INIT_MS;
        this.resetPending = false;
        this.applyChainDepth = 0;
        this.pushCount = 0;

        // Clear storage (deleteAll covers KV; DROP TABLE covers SQL outbox + meta)
        await this.ctx.storage.deleteAll();
        this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${OUTBOX_TABLE}`);
        this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${OUTBOX_META_TABLE}`);
        await this.ctx.storage.deleteAlarm();
    }

    /**
     * Set stream to pending_approval status and broadcast.
     * Called by Worker when a tool requires human approval.
     */
    async setPendingApproval(toolCallId: string, tool: string, input: unknown) {
        await this.ensureLoaded();
        this.status = 'pending_approval';
        // TODO: broadcast tool info (toolCallId, tool, input) so client knows which tool needs approval
        await this.broadcastStatus('pending_approval');
        await this.drainBroadcastQueue();
    }

    /**
     * Resolve a tool approval long-poll — approved.
     */
    async toolApprove(toolCallId: string) {
        await this.ensureLoaded();
        const resolver = this.approvalResolvers.get(toolCallId);
        if (resolver) {
            resolver(true);
            this.approvalResolvers.delete(toolCallId);
        }
        this.status = 'streaming';
        await this.broadcastStatus('streaming');
        await this.drainBroadcastQueue();
    }

    /**
     * Resolve a tool approval long-poll — rejected.
     */
    async toolReject(toolCallId: string) {
        await this.ensureLoaded();
        const resolver = this.approvalResolvers.get(toolCallId);
        if (resolver) {
            resolver(false);
            this.approvalResolvers.delete(toolCallId);
        }
        this.status = 'aborted';
        await this.broadcastStatus('aborted');
        await this.drainBroadcastQueue();
    }

    /**
     * Long-poll for user tool approval/rejection decision.
     * Resolves true (approved) or false (rejected).
     */
    async toolApprovalWait(toolCallId: string): Promise<boolean> {
        await this.ensureLoaded();

        return new Promise<boolean>((resolve) => {
            this.approvalResolvers.set(toolCallId, resolve);
            setTimeout(() => {
                // Timeout → treat as rejection
                if (this.approvalResolvers.has(toolCallId)) {
                    this.approvalResolvers.delete(toolCallId);
                    resolve(false);
                }
            }, TOOL_APPROVAL_TIMEOUT_MS);
        });
    }

    // ========================================================================
    // USER DECISION LONG-POLL
    // ========================================================================

    /**
     * Long-poll for the user's choice on a `request_user_decision` tool call.
     * Resolves to a `{ value, freeText? }` object, or `null` if the user
     * dismissed / timed out. `freeText` is set when the user picked "Other"
     * and typed a custom answer.
     */
    async decisionWait(toolCallId: string): Promise<DecisionResult | null> {
        await this.ensureLoaded();

        return new Promise<DecisionResult | null>((resolve) => {
            this.decisionResolvers.set(toolCallId, resolve);
            setTimeout(() => {
                if (this.decisionResolvers.has(toolCallId)) {
                    this.decisionResolvers.delete(toolCallId);
                    // Drop the stale prompt from state so the UI card disappears.
                    this.pendingDecisions.delete(toolCallId);
                    resolve(null);
                }
            }, USER_DECISION_TIMEOUT_MS);
        });
    }

    /**
     * Resolve a user-decision long-poll with the user's click (option value or free text).
     * Called by the topic handler when the frontend sends `decision_select`.
     *
     * - Option click: `freeText` absent → validate value against pending options.
     * - "Other" path: `freeText` is the typed answer → value validation is skipped
     *   (the UI passes a sentinel value like "__other__").
     */
    async decisionSelect(toolCallId: string, value: string, freeText?: string) {
        await this.ensureLoaded();
        const pending = this.pendingDecisions.get(toolCallId);
        // Reject clicks on unknown toolCallIds — prevents stale-card double-submit.
        if (!pending) return;

        const trimmedText = freeText?.trim();
        if (trimmedText) {
            // Free-text path: any value is accepted, the text is the answer.
            // No option-validation needed.
        } else if (!pending.options.some((o) => o.value === value)) {
            // Option path: must match one of the offered values exactly.
            return;
        }

        const result: DecisionResult = trimmedText ? { value, freeText: trimmedText } : { value };

        const resolver = this.decisionResolvers.get(toolCallId);
        if (resolver) {
            resolver(result);
            this.decisionResolvers.delete(toolCallId);
        }
        this.pendingDecisions.delete(toolCallId);

        // Broadcast a `decision_resolved` event so any other subscribers (multi-tab)
        // also drop the card from their UI. Use a fresh seq outside the pusher
        // stream; the event is self-contained and order vs. agent output doesn't matter.
        await this.queueSequencedBroadcast([
            {
                topic: this.topic,
                type: 'stream_event',
                agentMessageId: this.agentMessageId,
                event: {
                    type: 'decision_resolved',
                    toolCallId,
                    value,
                    ...(trimmedText ? { freeText: trimmedText } : {}),
                } as StreamEvent,
            },
        ]);
        await this.drainBroadcastQueue();
    }

    /** Resolve the long-poll with `null` (same shape as a timeout) so the agent's tool gets the cancelled path. */
    async decisionDismiss(toolCallId: string) {
        await this.ensureLoaded();
        if (!this.pendingDecisions.has(toolCallId)) return;

        const resolver = this.decisionResolvers.get(toolCallId);
        if (resolver) {
            resolver(null);
            this.decisionResolvers.delete(toolCallId);
        }
        this.pendingDecisions.delete(toolCallId);

        await this.queueSequencedBroadcast([
            {
                topic: this.topic,
                type: 'stream_event',
                agentMessageId: this.agentMessageId,
                event: {
                    type: 'decision_resolved',
                    toolCallId,
                    value: DECISION_DISMISSED_SENTINEL,
                } as StreamEvent,
            },
        ]);
        await this.drainBroadcastQueue();
    }

    // ========================================================================
    // DEAD-MAN'S SWITCH (ALARM)
    // ========================================================================

    /**
     * DO alarm handler — dead-man's switch.
     * If stream is still active with no recent push, transition to error,
     * save errored empty agent message to DB, clear entity, then self-destruct.
     */
    async alarm() {
        await this.ensureLoaded();

        // Only trigger if stream is still active
        if (this.status === 'streaming' || this.status === 'pending_approval') {
            console.error(`ChatStreamDO: dead-man alarm fired for ${this.agentMessageId}, status was ${this.status}`);
            this.status = 'error';
            await this.broadcastStatus('error');
            await this.drainBroadcastQueue();
            await this.flushApplyChain();
            // DB cleanup: save errored placeholder message + clear activeAgentMessageId
            await this.dbCleanup();
            // Self-destruct after broadcasting error and DB cleanup
            await this.finalize();
        }
    }

    // ========================================================================
    // DB CLEANUP (dead-man's switch only)
    // ========================================================================

    /**
     * Save an errored empty agent message and clear activeAgentMessageId on the chat entity.
     * Called only from the alarm handler (Worker crash recovery).
     */
    private async dbCleanup() {
        if (!this.chatId || !this.agentMessageId) {
            console.warn('ChatStreamDO: skipping DB cleanup — missing chatId or agentMessageId');
            return;
        }

        try {
            await this.trackServicesRpc(
                () =>
                    this.env.CHAT_SERVICES.deadManCleanup({
                        topic: this.topic,
                        prefix: this.topicPrefix,
                        identifier: this.chatId,
                        agentMessageId: this.agentMessageId,
                        previewAlias: this.previewAlias ?? undefined,
                    }),
                'services_dead_man_cleanup_rpc',
                [this.topicPrefix],
            );
        } catch (err) {
            console.error('ChatStreamDO: DB cleanup failed', err);
        }
    }

    private async trackServicesRpc<T>(
        fn: () => Promise<T>,
        metric: string,
        blobs: Array<string | null | undefined> = [],
    ): Promise<T> {
        const t0 = performance.now();
        try {
            const result = await fn();
            this.trackStreamMetric(metric, [performance.now() - t0, 1], blobs);
            return result;
        } catch (err) {
            this.trackStreamMetric(metric, [performance.now() - t0, 0], blobs);
            throw err;
        }
    }
}
