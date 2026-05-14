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
import { writeStreamMetric } from '@/workers/_common/vendor/analytics-engine';
import createNeonSql from '@/workers/_common/vendor/neon';

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

export type StreamSubscribeResult = {
    snapshot: StreamSnapshot;
    /** High-water mark in the same coordinate as stream event `_seq`. */
    seqHigh: number;
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
const SK_BROADCAST_SEQ = 'broadcastSeq';

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
    private topicPrefix = 'chat';
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
            broadcastSeq,
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
            this.ctx.storage.get<number>(SK_BROADCAST_SEQ),
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
        if (topicPrefix) this.topicPrefix = topicPrefix;
        if (previewAlias) this.previewAlias = previewAlias;
        if (displayStatus) this.displayStatus = displayStatus;
        if (typeof broadcastSeq === 'number') this.broadcastSeq = broadcastSeq;
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
            [SK_BROADCAST_SEQ]: this.broadcastSeq,
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

    private sequenced<T extends SequencedStreamMessage>(message: T): T & { _seq: number } {
        return { ...message, _seq: this.broadcastSeq++ };
    }

    private async queueSequencedBroadcast(messages: SequencedStreamMessage[]) {
        const sequencedMessages = messages.map((message) => this.sequenced(message));
        await this.persistState();
        this.queueBroadcast(sequencedMessages);
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
        const sends: Promise<void>[] = [];
        for (const [userId] of this.subscribers) {
            sends.push(this.sendToUG(userId, messages));
        }
        await Promise.allSettled(sends);
    }

    /** Send messages to a single subscriber's UserGateway (awaited). */
    private async sendToUG(userId: string, messages: unknown[]): Promise<void> {
        const ugDoName = this.subscribers.get(userId);
        if (!ugDoName) return;
        try {
            const ugId = this.env.USER_GATEWAY.idFromName(ugDoName);
            const ugStub = this.env.USER_GATEWAY.get(ugId) as DurableObjectStub & {
                pushMessages(topic: string, messages: unknown[]): Promise<void>;
            };
            await ugStub.pushMessages(this.topic, messages);
        } catch (err) {
            console.error(`[ChatStreamDO] sendToUG FAILED: userId=${userId}`, err);
        }
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

        // Drain consecutive batches in order — apply synchronously, queue for broadcast
        const allDrained: StreamEvent[] = [];
        while (this.pendingBatches.has(this.nextExpectedSeq)) {
            const batch = this.pendingBatches.get(this.nextExpectedSeq)!;
            this.pendingBatches.delete(this.nextExpectedSeq);
            this.nextExpectedSeq++;

            for (const event of batch) {
                this.applyEvent(event);
            }
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
                    for (const event of batch) {
                        this.applyEvent(event);
                    }
                    allDrained.push(...batch);
                }
            }
        } else {
            // No gap — reset detector
            this.gapDetectedAt = null;
        }

        // Queue for serial broadcast — each event tagged with _seq for client-side verification
        if (allDrained.length > 0) {
            const messages = allDrained.map((event) => ({
                topic: this.topic,
                type: 'stream_event',
                agentMessageId: this.agentMessageId,
                event,
                _seq: this.broadcastSeq++,
            }));
            this.queueBroadcast(messages);
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
    }

    /**
     * Initialize the DO with chatId and agentMessageId. Must be called once
     * before any subscribe or push. Sets status idle, starts dead-man alarm.
     *
     * Called by ChatTopicHandler.registerStream() before broadcasting stream_started.
     */
    async init(
        chatId: string,
        agentMessageId: string,
        userMessageId: string,
        topicPrefix = 'chat',
        previewAlias?: string,
    ) {
        await this.ensureLoaded();
        this.chatId = chatId;
        this.agentMessageId = agentMessageId;
        this.userMessageId = userMessageId;
        this.topicPrefix = topicPrefix;
        this.previewAlias = previewAlias ?? null;
        this.status = 'idle';
        this.nextExpectedSeq = 0;
        this.pendingBatches.clear();
        this.gapDetectedAt = null;
        this.broadcastQueue = [];
        this.isBroadcasting = false;
        this.broadcastSeq = 0;
        await this.persistState();
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
     */
    async subscribe(userId: string, ugDoName: string): Promise<StreamSubscribeResult> {
        const t0 = performance.now();
        await this.ensureLoaded();

        // Registration must precede snapshot capture so broadcasts during subscribe reach the user's UG.
        this.subscribers.set(userId, ugDoName);
        await this.ctx.storage.put(SK_SUBSCRIBERS, [...this.subscribers.entries()]);

        const snapshot: StreamSnapshot = {
            blocks: this.blocks,
            activeDocuments: [...this.activeDocuments.values()],
            pendingDecisions: [...this.pendingDecisions.values()],
            status: this.status === 'idle' ? 'streaming' : this.status,
            displayStatus: this.displayStatus,
        };

        const seqHigh = this.broadcastSeq - 1;
        this.trackStreamMetric('subscribe', [performance.now() - t0, this.subscribers.size, seqHigh]);

        return {
            snapshot,
            seqHigh,
        };
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
     * Called by Worker after DB persistence.
     */
    async finalize() {
        // Resolve any pending decision long-polls with null so the agent side
        // doesn't hang waiting on a DO that's about to die.
        for (const resolver of this.decisionResolvers.values()) {
            resolver(null);
        }
        this.decisionResolvers.clear();

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

        // Clear storage
        await this.ctx.storage.deleteAll();
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
     * Called only from the alarm handler (Worker crash recovery). Uses raw postgres
     * to avoid MikroORM initialization overhead in a rarely-fired cleanup path.
     */
    private async dbCleanup() {
        if (!this.chatId || !this.agentMessageId) {
            console.warn('ChatStreamDO: skipping DB cleanup — missing chatId or agentMessageId');
            return;
        }

        try {
            const sql = await createNeonSql(this.env, this.previewAlias ?? undefined);

            // Save errored empty agent message (idempotent — skip if already exists)
            await sql`
				INSERT INTO chat_messages (id, created_at, role, content, chat_id, blocks, is_error)
				VALUES (${this.agentMessageId}, NOW(), 'assistant', '', ${this.chatId}, '[]'::jsonb, true)
				ON CONFLICT (id) DO NOTHING
			`;

            // Clear active_agent_message_id (only if it still points to us)
            await sql`
				UPDATE chats SET active_agent_message_id = NULL
				WHERE id = ${this.chatId} AND active_agent_message_id = ${this.agentMessageId}
			`;
        } catch (err) {
            console.error('ChatStreamDO: DB cleanup failed', err);
        }
    }
}
